import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("omnichannel PG tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("omnichannel inbox durability (PostgreSQL)", () => {
  it("dedupes repeated provider events and scopes message ids per account", async () => {
    requireIsolatedDb();
    const { persistCanonicalMessage, ingestConnectorEvents } = await import("./connectors/inbound.ts");
    const { whatsappAdapter } = await import("./connectors/whatsapp.ts");
    const { db, crmChannelAccountsTable, crmMessagesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);
    const [accountB] = await db
      .insert(crmChannelAccountsTable)
      .values({
        channel: "whatsapp",
        providerAccountId: `phone-${suffix}`,
        displayName: "WA B",
        connectionStatus: "IMPLEMENTED_AWAITING_CREDENTIALS",
        capabilities: {},
        enabled: true,
        missingRequirements: [],
      })
      .returning();
    assert.ok(accountB);
    const a = await persistCanonicalMessage({
      channel: "whatsapp",
      providerAccountId: "cloud-api",
      providerMessageId: `wamid.${suffix}`,
      externalThreadId: "15550001111",
      providerUserId: "15550001111",
      direction: "inbound",
      bodyText: "hello a",
      sender: { providerUserId: "15550001111" },
      recipients: [],
      attachments: [],
      idempotencyKey: `idem-a-${suffix}`,
      allowlistedMetadata: {},
      verifiedPhone: "+15550001111",
    });
    const again = await persistCanonicalMessage({
      channel: "whatsapp",
      providerAccountId: "cloud-api",
      providerMessageId: `wamid.${suffix}`,
      externalThreadId: "15550001111",
      providerUserId: "15550001111",
      direction: "inbound",
      bodyText: "hello a",
      sender: { providerUserId: "15550001111" },
      recipients: [],
      attachments: [],
      idempotencyKey: `idem-a-${suffix}`,
      allowlistedMetadata: {},
      verifiedPhone: "+15550001111",
    });
    assert.equal(again.duplicate, true);
    const b = await persistCanonicalMessage({
      channel: "whatsapp",
      providerAccountId: accountB.providerAccountId,
      providerMessageId: `wamid.${suffix}`,
      externalThreadId: "15550002222",
      providerUserId: "15550002222",
      direction: "inbound",
      bodyText: "hello b",
      sender: { providerUserId: "15550002222" },
      recipients: [],
      attachments: [],
      idempotencyKey: `idem-b-${suffix}`,
      allowlistedMetadata: {},
      verifiedPhone: "+15550002222",
    });
    assert.notEqual(a.inquiryId, b.inquiryId);
    const rows = await db
      .select()
      .from(crmMessagesTable)
      .where(eq(crmMessagesTable.providerMessageId, `wamid.${suffix}`));
    assert.equal(rows.length, 2);
    const ingest1 = await ingestConnectorEvents({
      adapter: whatsappAdapter,
      rawBody: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
      body: {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "cloud-api" },
                  messages: [{ id: `evt-${suffix}`, from: "15550001111", type: "text", text: { body: "x" } }],
                },
              },
            ],
          },
        ],
      },
    });
    const ingest2 = await ingestConnectorEvents({
      adapter: whatsappAdapter,
      rawBody: "ignored-for-event-id",
      body: {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "cloud-api" },
                  messages: [{ id: `evt-${suffix}`, from: "15550001111", type: "text", text: { body: "x" } }],
                },
              },
            ],
          },
        ],
      },
    });
    assert.ok(ingest1.accepted >= 1);
    assert.equal(ingest2.duplicates, 1);
  });

  it("applies delivery receipts that arrive before the message and orders by provider timestamp", async () => {
    requireIsolatedDb();
    const { ingestConnectorEvents, persistCanonicalMessage } = await import("./connectors/inbound.ts");
    const { whatsappAdapter } = await import("./connectors/whatsapp.ts");
    const { db, crmMessagesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);
    const mid = `wamid-pending-${suffix}`;
    await ingestConnectorEvents({
      adapter: whatsappAdapter,
      rawBody: `status-${mid}`,
      body: {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "cloud-api" },
                  statuses: [{ id: mid, status: "delivered" }],
                },
              },
            ],
          },
        ],
      },
    });
    await persistCanonicalMessage({
      channel: "whatsapp",
      providerAccountId: "cloud-api",
      providerMessageId: mid,
      externalThreadId: "15550003333",
      providerUserId: "15550003333",
      direction: "outbound",
      bodyText: "later message",
      sender: { providerUserId: "staff" },
      recipients: [],
      attachments: [],
      idempotencyKey: `idem-pending-${suffix}`,
      allowlistedMetadata: {},
      providerTimestamp: new Date("2026-01-02T00:00:00.000Z"),
    });
    const [row] = await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.providerMessageId, mid));
    assert.equal(row?.deliveryStatus, "delivered");

    const thread = `thread-order-${suffix}`;
    const first = await persistCanonicalMessage({
      channel: "whatsapp",
      providerAccountId: "cloud-api",
      providerMessageId: `late-${suffix}`,
      externalThreadId: thread,
      providerUserId: "15550004444",
      direction: "inbound",
      bodyText: "second",
      sender: { providerUserId: "15550004444" },
      recipients: [],
      attachments: [],
      idempotencyKey: `idem-late-${suffix}`,
      allowlistedMetadata: {},
      providerTimestamp: new Date("2026-02-02T00:00:00.000Z"),
    });
    await persistCanonicalMessage({
      channel: "whatsapp",
      providerAccountId: "cloud-api",
      providerMessageId: `early-${suffix}`,
      externalThreadId: thread,
      providerUserId: "15550004444",
      direction: "inbound",
      bodyText: "first",
      sender: { providerUserId: "15550004444" },
      recipients: [],
      attachments: [],
      idempotencyKey: `idem-early-${suffix}`,
      allowlistedMetadata: {},
      providerTimestamp: new Date("2026-02-01T00:00:00.000Z"),
    });
    const msgs = await db
      .select()
      .from(crmMessagesTable)
      .where(eq(crmMessagesTable.inquiryId, first.inquiryId));
    const ordered = [...msgs].sort(
      (a, b) =>
        (a.providerTimestamp ?? a.createdAt).getTime() - (b.providerTimestamp ?? b.createdAt).getTime() ||
        a.id.localeCompare(b.id),
    );
    assert.equal(ordered[0]?.body, "first");
    assert.equal(ordered[1]?.body, "second");
  });

  it("quarantines malformed events and rejects unsupported outbound plus expired reply windows", async () => {
    requireIsolatedDb();
    const { ingestConnectorEvents } = await import("./connectors/inbound.ts");
    const { whatsappAdapter } = await import("./connectors/whatsapp.ts");
    const { queueStaffReply } = await import("./connectors/outbound.ts");
    const { ConnectorCapabilityError } = await import("./connectors/types.ts");
    const { db, crmContactsTable, crmInquiriesTable, crmConversationsTable, crmEmailQuarantineTable } = await import(
      "@workspace/db"
    );
    const suffix = randomUUID().slice(0, 8);
    const quarantined = await ingestConnectorEvents({
      adapter: whatsappAdapter,
      rawBody: "{}",
      body: { nope: true },
    });
    assert.equal(quarantined.quarantined, 1);
    const q = await db.select().from(crmEmailQuarantineTable);
    assert.ok(q.length >= 1);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "T",
        lastName: "K",
        jobTitle: "Buyer",
        email: `tk.${suffix}@example.com`,
        emailNormalized: `tk.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [tiktok] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-TK-${suffix}`,
        contactId: contact!.id,
        channel: "tiktok",
        inquiryType: "general",
      })
      .returning();
    await db.insert(crmConversationsTable).values({ inquiryId: tiktok!.id, channel: "tiktok" });
    await assert.rejects(
      () => queueStaffReply({ inquiryId: tiktok!.id, staffId: randomUUID(), body: "nope" }),
      (err: unknown) => err instanceof ConnectorCapabilityError && (err.code === "UNSUPPORTED_BY_PUBLIC_API" || err.code === "MANUAL_HANDOFF"),
    );
    const [wa] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-WA-${suffix}`,
        contactId: contact!.id,
        channel: "whatsapp",
        inquiryType: "general",
      })
      .returning();
    await db.insert(crmConversationsTable).values({
      inquiryId: wa!.id,
      channel: "whatsapp",
      lastInboundAt: new Date(Date.now() - 30 * 3600_000),
    });
    await assert.rejects(
      () => queueStaffReply({ inquiryId: wa!.id, staffId: randomUUID(), body: "too late" }),
      (err: unknown) => err instanceof ConnectorCapabilityError && err.code === "REPLY_WINDOW_CLOSED",
    );
  });

  it("matches identity by provider id / verified email / phone and never by name, with audited link/unlink", async () => {
    requireIsolatedDb();
    const { persistCanonicalMessage } = await import("./connectors/inbound.ts");
    const { staffLinkIdentity, staffUnlinkIdentity } = await import("./connectors/identity.ts");
    const { db, crmContactsTable, crmChannelIdentitiesTable, crmAuditEventsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);
    const email = `verified.${suffix}@example.com`;
    const [existing] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Known",
        lastName: "Person",
        jobTitle: "Buyer",
        email,
        emailNormalized: email,
        country: "US",
        phoneE164: `+15551${suffix.slice(0, 6)}`.padEnd(12, "0"),
      })
      .returning();
    const byEmail = await persistCanonicalMessage({
      channel: "website",
      providerAccountId: "contact-form",
      providerMessageId: `web-${suffix}`,
      externalThreadId: `web-${suffix}`,
      providerUserId: email,
      direction: "inbound",
      bodyText: "form",
      sender: { displayName: "Someone Else Entirely", email },
      recipients: [],
      attachments: [],
      idempotencyKey: `idem-email-${suffix}`,
      allowlistedMetadata: {},
      verifiedEmail: email,
    });
    assert.equal(byEmail.inquiryId.length > 0, true);
    const [linked] = await db
      .select()
      .from(crmChannelIdentitiesTable)
      .where(eq(crmChannelIdentitiesTable.providerUserId, email));
    assert.equal(linked?.contactId, existing!.id);
    const waUser = `15557${suffix}`;
    const nameOnly = await persistCanonicalMessage({
      channel: "whatsapp",
      providerAccountId: "cloud-api",
      providerMessageId: `wa-name-${suffix}`,
      externalThreadId: waUser,
      providerUserId: waUser,
      direction: "inbound",
      bodyText: "hi",
      sender: { displayName: "Known Person", providerUserId: waUser },
      recipients: [],
      attachments: [],
      idempotencyKey: `idem-name-${suffix}`,
      allowlistedMetadata: {},
    });
    const [provisional] = await db
      .select()
      .from(crmChannelIdentitiesTable)
      .where(eq(crmChannelIdentitiesTable.providerUserId, waUser));
    assert.notEqual(provisional?.contactId, existing!.id);
    assert.equal(provisional?.confidence, "low");
    const actor = randomUUID();
    await staffLinkIdentity({ identityId: provisional!.id, contactId: existing!.id, actorStaffId: actor });
    const [afterLink] = await db
      .select()
      .from(crmChannelIdentitiesTable)
      .where(eq(crmChannelIdentitiesTable.id, provisional!.id));
    assert.equal(afterLink?.contactId, existing!.id);
    await staffUnlinkIdentity({ identityId: provisional!.id, actorStaffId: actor });
    const audits = await db.select().from(crmAuditEventsTable).where(eq(crmAuditEventsTable.entityId, provisional!.id));
    assert.ok(audits.some((a) => a.action === "identity.linked"));
    assert.ok(audits.some((a) => a.action === "identity.unlinked"));
    assert.ok(nameOnly.inquiryId);
  });

  it("queues concurrent replies as separate durable effects and retries failed outbound with audit", async () => {
    requireIsolatedDb();
    const { queueStaffReply, retryOutboundMessage } = await import("./connectors/outbound.ts");
    const { db, crmContactsTable, crmInquiriesTable, crmConversationsTable, crmMessagesTable, crmJobEffectsTable, crmAuditEventsTable } =
      await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "C",
        lastName: "R",
        jobTitle: "Buyer",
        email: `cr.${suffix}@example.com`,
        emailNormalized: `cr.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-CR-${suffix}`,
        contactId: contact!.id,
        channel: "whatsapp",
        inquiryType: "general",
      })
      .returning();
    await db.insert(crmConversationsTable).values({
      inquiryId: inquiry!.id,
      channel: "whatsapp",
      lastInboundAt: new Date(),
    });
    const staffId = randomUUID();
    const [one, two] = await Promise.all([
      queueStaffReply({ inquiryId: inquiry!.id, staffId, body: "one" }),
      queueStaffReply({ inquiryId: inquiry!.id, staffId, body: "two" }),
    ]);
    assert.notEqual(one.messageId, two.messageId);
    const effects = await db.select().from(crmJobEffectsTable);
    assert.ok(effects.filter((e) => e.idempotencyKey.startsWith("outbound:")).length >= 2);
    await db.update(crmMessagesTable).set({ deliveryStatus: "failed" }).where(eq(crmMessagesTable.id, one.messageId));
    const retried = await retryOutboundMessage({ messageId: one.messageId, staffId });
    assert.equal(retried.deliveryStatus, "queued");
    const audit = await db.select().from(crmAuditEventsTable).where(eq(crmAuditEventsTable.entityId, one.messageId));
    assert.ok(audit.some((a) => a.action === "outbound.retried"));
  });
});
