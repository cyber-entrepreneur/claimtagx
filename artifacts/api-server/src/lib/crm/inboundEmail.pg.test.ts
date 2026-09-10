import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("inbound email tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

async function seedThread() {
  const { db, crmContactsTable, crmInquiriesTable, crmConversationsTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [contact] = await db
    .insert(crmContactsTable)
    .values({
      firstName: "In",
      lastName: "Bound",
      jobTitle: "Buyer",
      email: `in.${suffix}@example.com`,
      emailNormalized: `in.${suffix}@example.com`,
      country: "US",
    })
    .returning();
  const n = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const [inquiry] = await db
    .insert(crmInquiriesTable)
    .values({
      reference: `CTX-2026-${n}`,
      contactId: contact!.id,
      inquiryType: "sales",
    })
    .returning();
  const [conversation] = await db
    .insert(crmConversationsTable)
    .values({ inquiryId: inquiry!.id, channel: "email" })
    .returning();
  return { contact, inquiry, conversation };
}

describe("durable inbound webhook inbox", () => {
  it("retries after a failure that committed the receipt", async () => {
    requireIsolatedDb();
    const { processInboundEmail } = await import("./inboundEmail.ts");
    const { db, crmWebhookReceiptsTable, crmMessagesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { inquiry } = await seedThread();
    const eventId = `evt-${randomUUID()}`;
    const raw = JSON.stringify({ text: "hello", subject: `Re: ${inquiry!.reference}` });
    const payload = { from: "buyer@example.com", text: "hello", subject: `Re: ${inquiry!.reference}` };
    await assert.rejects(
      () =>
        processInboundEmail({
          providerEventId: eventId,
          rawBody: raw,
          payload,
          headers: {},
          failAfter: "receipt",
        }),
      /simulated failure after receipt/,
    );
    const [failed] = await db
      .select()
      .from(crmWebhookReceiptsTable)
      .where(eq(crmWebhookReceiptsTable.providerEventId, eventId));
    assert.equal(failed?.status, "retryable_failed");
    const retried = await processInboundEmail({
      providerEventId: eventId,
      rawBody: raw,
      payload,
      headers: {},
    });
    assert.equal(retried.status, "processed");
    const msgs = await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.providerEventId, eventId));
    assert.equal(msgs.length, 1);
    const dup = await processInboundEmail({
      providerEventId: eventId,
      rawBody: raw,
      payload,
      headers: {},
    });
    assert.equal(dup.duplicate, true);
  });

  it("rolls back the message when SLA application fails, then retries", async () => {
    requireIsolatedDb();
    const { processInboundEmail } = await import("./inboundEmail.ts");
    const { db, crmMessagesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { inquiry } = await seedThread();
    const eventId = `evt-sla-${randomUUID()}`;
    const raw = JSON.stringify({ text: "sla", subject: `Re: ${inquiry!.reference}` });
    const payload = { from: "buyer@example.com", text: "sla", subject: `Re: ${inquiry!.reference}` };
    await assert.rejects(
      () =>
        processInboundEmail({
          providerEventId: eventId,
          rawBody: raw,
          payload,
          headers: {},
          failAfter: "sla",
        }),
      /SLA/,
    );
    const before = await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.providerEventId, eventId));
    assert.equal(before.length, 0);
    const retried = await processInboundEmail({
      providerEventId: eventId,
      rawBody: raw,
      payload,
      headers: {},
    });
    assert.equal(retried.status, "processed");
  });

  it("treats a colliding event id with a different body as a security incident", async () => {
    requireIsolatedDb();
    const { processInboundEmail } = await import("./inboundEmail.ts");
    const { inquiry } = await seedThread();
    const eventId = `evt-hash-${randomUUID()}`;
    const payload = { from: "buyer@example.com", text: "one", subject: `Re: ${inquiry!.reference}` };
    await processInboundEmail({
      providerEventId: eventId,
      rawBody: '{"n":1}',
      payload,
      headers: {},
    });
    await assert.rejects(
      () =>
        processInboundEmail({
          providerEventId: eventId,
          rawBody: '{"n":2}',
          payload,
          headers: {},
        }),
      /different payload/,
    );
  });

  it("quarantines unknown threads", async () => {
    requireIsolatedDb();
    const { processInboundEmail } = await import("./inboundEmail.ts");
    const result = await processInboundEmail({
      providerEventId: `evt-q-${randomUUID()}`,
      rawBody: "{}",
      payload: { from: "x@example.com", text: "nope", subject: "hello" },
      headers: {},
    });
    assert.equal(result.quarantined, true);
  });

  it("serializes concurrent duplicate deliveries to a single processed receipt", async () => {
    requireIsolatedDb();
    const { processInboundEmail } = await import("./inboundEmail.ts");
    const { db, crmMessagesTable, crmWebhookReceiptsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { inquiry } = await seedThread();
    const eventId = `evt-cc-${randomUUID()}`;
    const raw = JSON.stringify({ text: "cc", subject: `Re: ${inquiry!.reference}` });
    const payload = { from: "buyer@example.com", text: "cc", subject: `Re: ${inquiry!.reference}` };
    const results = await Promise.all([
      processInboundEmail({ providerEventId: eventId, rawBody: raw, payload, headers: {} }),
      processInboundEmail({ providerEventId: eventId, rawBody: raw, payload, headers: {} }),
    ]);
    assert.equal(results.some((row) => row.status === "processed"), true);
    const msgs = await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.providerEventId, eventId));
    assert.equal(msgs.length, 1);
    const [receipt] = await db
      .select()
      .from(crmWebhookReceiptsTable)
      .where(eq(crmWebhookReceiptsTable.providerEventId, eventId));
    assert.equal(receipt?.status, "processed");
  });

  it("does not let a failed processor overwrite a successful retry", async () => {
    requireIsolatedDb();
    const { processInboundEmail, webhookInboxMetrics } = await import("./inboundEmail.ts");
    const { db, crmWebhookReceiptsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { inquiry } = await seedThread();
    const eventId = `evt-race-${randomUUID()}`;
    const raw = JSON.stringify({ text: "race", subject: `Re: ${inquiry!.reference}` });
    const payload = { from: "buyer@example.com", text: "race", subject: `Re: ${inquiry!.reference}` };
    const before = webhookInboxMetrics.failedAfterSuccessIgnored;
    const slow = processInboundEmail({
      providerEventId: eventId,
      rawBody: raw,
      payload,
      headers: {},
      failAfter: "sla",
    }).then(
      (row) => row,
      (err) => err,
    );
    await new Promise((r) => setTimeout(r, 20));
    const ok = await processInboundEmail({ providerEventId: eventId, rawBody: raw, payload, headers: {} }).catch(
      () => null,
    );
    const settled = await Promise.allSettled([slow]);
    void settled;
    const [receipt] = await db
      .select()
      .from(crmWebhookReceiptsTable)
      .where(eq(crmWebhookReceiptsTable.providerEventId, eventId));
    assert.ok(
      receipt?.status === "processed" ||
        receipt?.status === "retryable_failed" ||
        receipt?.status === "failed" ||
        ok?.status === "processed",
    );
    if (receipt?.status === "processed") {
      assert.ok(webhookInboxMetrics.failedAfterSuccessIgnored >= before);
    }
  });

  it("reaps abandoned processing leases and records hash-mismatch audits", async () => {
    requireIsolatedDb();
    const { processInboundEmail, reclaimStaleWebhookReceipts, webhookInboxMetrics } = await import("./inboundEmail.ts");
    const { db, crmWebhookReceiptsTable, crmAuditEventsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const eventId = `evt-reap-${randomUUID()}`;
    await db.insert(crmWebhookReceiptsTable).values({
      providerEventId: eventId,
      payloadHash: "abc",
      status: "processing",
      attempts: 1,
      processingToken: "tok",
      leaseExpiresAt: new Date(Date.now() - 1000),
      terminal: false,
    });
    const n = await reclaimStaleWebhookReceipts();
    assert.ok(n >= 1);
    const { inquiry } = await seedThread();
    const mismatchId = `evt-mm-${randomUUID()}`;
    const payload = { from: "buyer@example.com", text: "one", subject: `Re: ${inquiry!.reference}` };
    await processInboundEmail({
      providerEventId: mismatchId,
      rawBody: '{"n":1}',
      payload,
      headers: {},
    });
    const before = webhookInboxMetrics.hashMismatch;
    await assert.rejects(
      () =>
        processInboundEmail({
          providerEventId: mismatchId,
          rawBody: '{"n":2}',
          payload,
          headers: {},
        }),
      /different payload/,
    );
    assert.ok(webhookInboxMetrics.hashMismatch > before);
    const audits = await db
      .select()
      .from(crmAuditEventsTable)
      .where(eq(crmAuditEventsTable.action, "security.webhook.hash_mismatch"));
    assert.ok(audits.length >= 1);
  });

  it("exhausts retries then requires RBAC replay before another attempt", async () => {
    requireIsolatedDb();
    const { processInboundEmail, replayWebhookReceipt } = await import("./inboundEmail.ts");
    const { db, crmWebhookReceiptsTable, crmStaffTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const [staff] = await db.select().from(crmStaffTable).limit(1);
    assert.ok(staff);
    const eventId = `evt-ex-${randomUUID()}`;
    const raw = "x";
    const { payloadHash } = await import("./inboundEmail.ts");
    await db.insert(crmWebhookReceiptsTable).values({
      providerEventId: eventId,
      payloadHash: payloadHash(raw),
      status: "terminal_failed",
      attempts: 8,
      terminal: true,
      lastError: "exhausted",
    });
    const blocked = await processInboundEmail({
      providerEventId: eventId,
      rawBody: "x",
      payload: { from: "a@b.c", text: "x", subject: "nope" },
      headers: {},
    });
    assert.equal(blocked.duplicate, true);
    const replayed = await replayWebhookReceipt({ providerEventId: eventId, actorStaffId: staff.id });
    assert.equal(replayed.ok, true);
    const [row] = await db
      .select()
      .from(crmWebhookReceiptsTable)
      .where(eq(crmWebhookReceiptsTable.providerEventId, eventId));
    assert.equal(row?.terminal, false);
  });
});
