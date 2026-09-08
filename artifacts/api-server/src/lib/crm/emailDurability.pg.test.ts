import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("email durability tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

async function fixture() {
  const { ensureCrmSeeded } = await import("./seed.ts");
  await ensureCrmSeeded();
  const { db, crmContactsTable, crmInquiriesTable, crmConversationsTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [contact] = await db
    .insert(crmContactsTable)
    .values({
      firstName: "Mail",
      lastName: "er",
      jobTitle: "Buyer",
      email: `mail.${suffix}@example.com`,
      emailNormalized: `mail.${suffix}@example.com`,
      country: "US",
    })
    .returning();
  const n = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const [inquiry] = await db
    .insert(crmInquiriesTable)
    .values({ reference: `CTX-2026-${n}`, contactId: contact!.id, inquiryType: "sales" })
    .returning();
  await db.insert(crmConversationsTable).values({ inquiryId: inquiry!.id, channel: "email" });
  return { inquiry: inquiry!, contact: contact! };
}

async function claimSpecificJob(workerId: string, idempotencyKey: string) {
  const { db, crmJobsTable } = await import("@workspace/db");
  const { eq, sql } = await import("drizzle-orm");
  const [job] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.idempotencyKey, idempotencyKey)).limit(1);
  if (!job) throw new Error(`job ${idempotencyKey} not enqueued`);
  const [updated] = await db
    .update(crmJobsTable)
    .set({
      status: "running",
      lockedBy: workerId,
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 120_000),
      claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
      attempts: sql`${crmJobsTable.attempts} + 1`,
    })
    .where(eq(crmJobsTable.id, job.id))
    .returning();
  if (!updated) throw new Error("failed to claim test job");
  return updated;
}

describe("outbound email durability simulator", () => {
  it("does not duplicate on retry of the same logical message and allows a second legitimate template send", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_EMAIL_SIMULATOR = "true";
    const sim = await import("./emailSimulator.ts");
    sim.resetEmailSimulator();
    const { inquiry } = await fixture();
    const { enqueueJob, claimJobs } = await import("./queue.ts");
    const { sendInquiryEmail } = await import("./jobs.ts");
    const { emailEffectKey, loadEffect } = await import("./effects.ts");
    const logical = randomUUID();
    await enqueueJob("send_ack", { inquiryId: inquiry.id }, { idempotencyKey: `ack-${logical}` });
    const job = await claimSpecificJob("mail-w", `ack-${logical}`);
    const ctx = {
      jobId: job!.id,
      workerId: "mail-w",
      claimGeneration: job!.claimGeneration,
      signal: new AbortController().signal,
    };
    const first = await sendInquiryEmail(inquiry.id, "STANDARD_ACKNOWLEDGMENT", { logicalIntentId: logical }, ctx);
    assert.ok(first?.messageId);
    const again = await sendInquiryEmail(inquiry.id, "STANDARD_ACKNOWLEDGMENT", { logicalIntentId: logical }, ctx);
    assert.equal(again, null);
    const key = emailEffectKey({
      inquiryId: inquiry.id,
      templateKey: "STANDARD_ACKNOWLEDGMENT",
      intent: "template",
      logicalIntentId: logical,
    });
    assert.equal(sim.simulatedSendCount(key), 1);
    const secondIntent = randomUUID();
    await enqueueJob("send_ack2", { inquiryId: inquiry.id }, { idempotencyKey: `ack2-${secondIntent}` });
    const job2 = await claimSpecificJob("mail-w2", `ack2-${secondIntent}`);
    const ctx2 = {
      jobId: job2!.id,
      workerId: "mail-w2",
      claimGeneration: job2!.claimGeneration,
      signal: new AbortController().signal,
    };
    const second = await sendInquiryEmail(
      inquiry.id,
      "STANDARD_ACKNOWLEDGMENT",
      { logicalIntentId: secondIntent },
      ctx2,
    );
    assert.ok(second?.messageId);
    assert.notEqual(second!.messageId, first!.messageId);
    const row = await loadEffect(key);
    assert.equal(row?.status, "committed");
  });

  it("marks uncertain after provider acceptance crash and reconciles without a second send", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_EMAIL_SIMULATOR = "true";
    process.env.CRM_TEST_EFFECT_FAIL_AT = "after_provider";
    const sim = await import("./emailSimulator.ts");
    sim.resetEmailSimulator();
    const { inquiry } = await fixture();
    const { enqueueJob, claimJobs } = await import("./queue.ts");
    const { sendInquiryEmail } = await import("./jobs.ts");
    const { emailEffectKey, loadEffect, reconcileUncertainEmail } = await import("./effects.ts");
    const logical = randomUUID();
    await enqueueJob("send_unc", { inquiryId: inquiry.id }, { idempotencyKey: `unc-${logical}` });
    const job = await claimSpecificJob("mail-u", `unc-${logical}`);
    const ctx = {
      jobId: job!.id,
      workerId: "mail-u",
      claimGeneration: job!.claimGeneration,
      signal: new AbortController().signal,
    };
    await assert.rejects(
      () => sendInquiryEmail(inquiry.id, "STANDARD_ACKNOWLEDGMENT", { logicalIntentId: logical }, ctx),
      /after provider/,
    );
    delete process.env.CRM_TEST_EFFECT_FAIL_AT;
    const key = emailEffectKey({
      inquiryId: inquiry.id,
      templateKey: "STANDARD_ACKNOWLEDGMENT",
      intent: "template",
      logicalIntentId: logical,
    });
    const row = await loadEffect(key);
    assert.equal(row?.status, "uncertain");
    const recon = await reconcileUncertainEmail(key);
    assert.equal(recon, "accepted");
    assert.equal(sim.simulatedSendCount(key), 1);
  });

  it("timeout before acceptance stays unknown until reconciliation finds no send and becomes retryable", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_EMAIL_SIMULATOR = "true";
    const sim = await import("./emailSimulator.ts");
    sim.resetEmailSimulator();
    sim.simulatedProviderConfig.nextOutcome = "timeout_before_accept";
    const { inquiry } = await fixture();
    const { enqueueJob, claimJobs } = await import("./queue.ts");
    const { sendInquiryEmail } = await import("./jobs.ts");
    const { emailEffectKey, loadEffect, reconcileUncertainEmail } = await import("./effects.ts");
    const logical = randomUUID();
    await enqueueJob("send_to", { inquiryId: inquiry.id }, { idempotencyKey: `to-${logical}` });
    const job = await claimSpecificJob("mail-t", `to-${logical}`);
    const ctx = {
      jobId: job!.id,
      workerId: "mail-t",
      claimGeneration: job!.claimGeneration,
      signal: new AbortController().signal,
    };
    await assert.rejects(() =>
      sendInquiryEmail(inquiry.id, "STANDARD_ACKNOWLEDGMENT", { logicalIntentId: logical }, ctx),
    );
    const key = emailEffectKey({
      inquiryId: inquiry.id,
      templateKey: "STANDARD_ACKNOWLEDGMENT",
      intent: "template",
      logicalIntentId: logical,
    });
    assert.equal((await loadEffect(key))?.status, "uncertain");
    sim.resetEmailSimulator();
    const recon = await reconcileUncertainEmail(key);
    assert.equal(recon, "retryable");
  });
});
