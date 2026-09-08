import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("contact merge tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("contact merge integrity", () => {
  it("transactionally reassigns inquiries, consent, and merge history", async () => {
    requireIsolatedDb();
    const { db, crmContactsTable, crmInquiriesTable, crmConsentRecordsTable, crmLegalHoldsTable } =
      await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { applyContactMerge } = await import("./contactMerge.ts");
    const suffix = randomUUID().slice(0, 8);
    const [winner] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Win",
        lastName: "Ner",
        jobTitle: "Buyer",
        email: `win.${suffix}@example.com`,
        emailNormalized: `win.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [loser] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Los",
        lastName: "Er",
        jobTitle: "Buyer",
        email: `lose.${suffix}@example.com`,
        emailNormalized: `lose.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    assert.ok(winner && loser);
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-2099-${suffix.slice(0, 6).toUpperCase()}`,
        contactId: loser.id,
        inquiryType: "sales",
      })
      .returning();
    await db.insert(crmConsentRecordsTable).values({
      contactId: loser.id,
      kind: "terms",
      granted: true,
      termsVersion: "2026-04-20",
    });
    await db.insert(crmLegalHoldsTable).values({
      contactId: loser.id,
      reason: "litigation hold for merge test",
    });
    const key = `merge-${suffix}`;
    await assert.rejects(
      () =>
        applyContactMerge({
          winnerId: winner.id,
          loserId: loser.id,
          idempotencyKey: key,
        }),
      /legal hold/,
    );
    const first = await applyContactMerge({
      winnerId: winner.id,
      loserId: loser.id,
      idempotencyKey: key,
      allowLegalHoldMerge: true,
    });
    assert.equal(first.replayed, false);
    const replay = await applyContactMerge({
      winnerId: winner.id,
      loserId: loser.id,
      idempotencyKey: key,
    });
    assert.equal(replay.replayed, true);
    const [movedInquiry] = await db
      .select()
      .from(crmInquiriesTable)
      .where(eq(crmInquiriesTable.id, inquiry.id))
      .limit(1);
    assert.equal(movedInquiry?.contactId, winner.id);
    const consents = await db
      .select()
      .from(crmConsentRecordsTable)
      .where(eq(crmConsentRecordsTable.contactId, winner.id));
    assert.equal(consents.length >= 1, true);
    const holds = await db.select().from(crmLegalHoldsTable).where(eq(crmLegalHoldsTable.contactId, winner.id));
    assert.equal(holds.length >= 1, true);
    const [loserRow] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, loser.id)).limit(1);
    assert.match(loserRow?.emailNormalized ?? "", /@merged\.invalid$/);
  });

  it("rejects same-contact, idempotency mismatch, and consent conflict", async () => {
    requireIsolatedDb();
    const { db, crmContactsTable, crmConsentRecordsTable } = await import("@workspace/db");
    const { applyContactMerge } = await import("./contactMerge.ts");
    const suffix = randomUUID().slice(0, 8);
    const [a] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "A",
        lastName: "One",
        jobTitle: "Buyer",
        email: `a.${suffix}@example.com`,
        emailNormalized: `a.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [b] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "B",
        lastName: "Two",
        jobTitle: "Buyer",
        email: `b.${suffix}@example.com`,
        emailNormalized: `b.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    assert.ok(a && b);
    await assert.rejects(() => applyContactMerge({ winnerId: a.id, loserId: a.id, idempotencyKey: `k-${suffix}` }), /distinct/);
    await db.insert(crmConsentRecordsTable).values({
      contactId: a.id,
      kind: "marketing",
      granted: true,
      termsVersion: "v1",
    });
    await db.insert(crmConsentRecordsTable).values({
      contactId: b.id,
      kind: "marketing",
      granted: false,
      termsVersion: "v2",
    });
    await assert.rejects(
      () => applyContactMerge({ winnerId: a.id, loserId: b.id, idempotencyKey: `consent-${suffix}` }),
      /Consent conflict/,
    );
    const [c] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "C",
        lastName: "Three",
        jobTitle: "Buyer",
        email: `c.${suffix}@example.com`,
        emailNormalized: `c.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    assert.ok(c);
    await applyContactMerge({ winnerId: a.id, loserId: c.id, idempotencyKey: `ok-${suffix}` });
    await assert.rejects(
      () => applyContactMerge({ winnerId: b.id, loserId: a.id, idempotencyKey: `ok-${suffix}` }),
      /different merge payload/,
    );
    await assert.rejects(
      () => applyContactMerge({ winnerId: a.id, loserId: c.id, idempotencyKey: `again-${suffix}` }),
      /already merged/,
    );
  });
});
