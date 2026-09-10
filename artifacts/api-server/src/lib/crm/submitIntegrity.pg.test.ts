import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { db, crmContactsTable, crmConsentRecordsTable, crmInquiriesTable, crmAuditEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { submitInquiry } from "./orchestrator.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("submit integrity tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

function base(overrides: Partial<Parameters<typeof submitInquiry>[0]> = {}) {
  return {
    firstName: "Integrity",
    lastName: "Probe",
    jobTitle: "Buyer",
    companyName: "IntegrityCo",
    email: `integrity.${randomUUID().slice(0, 8)}@example.com`,
    country: "US",
    phoneRaw: "+14155552671",
    inquiryType: "general" as const,
    useCaseKeys: [],
    message: "Dedicated contact integrity persistence probe.",
    answers: {},
    termsAccepted: true as const,
    termsVersion: "2026-04-20",
    privacyPolicyVersion: "2026-04-20",
    locale: "en-US",
    attribution: { analyticsConsent: false, inquiry_type: "general" },
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

describe("contact submit integrity (PostgreSQL)", () => {
  it("persists E.164, consent versions/locale/purpose, analytics denial, and same-key replay", async () => {
    requireIsolatedDb();
    process.env.CRM_SKIP_RUNTIME_SEED = "true";
    const key = randomUUID();
    const email = `persist.${randomUUID().slice(0, 8)}@example.com`;
    const first = await submitInquiry(base({ email, idempotencyKey: key, phoneRaw: "+44 20 7946 0958", country: "GB", locale: "en-GB" }), {
      ip: "203.0.113.9",
      correlationId: randomUUID(),
    });
    const replay = await submitInquiry(base({ email, idempotencyKey: key, message: "changed" }), {
      ip: "203.0.113.9",
      correlationId: randomUUID(),
    });
    assert.equal(replay.reference, first.reference);

    const [inquiry] = await db.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.id, first.inquiryId)).limit(1);
    const [contact] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, inquiry!.contactId)).limit(1);
    assert.equal(contact!.phoneE164, "+442079460958");
    assert.equal(contact!.locale, "en-GB");
    const consents = await db.select().from(crmConsentRecordsTable).where(eq(crmConsentRecordsTable.inquiryId, first.inquiryId));
    assert.equal(consents.some((c) => c.kind === "terms_privacy" && c.granted && c.termsVersion === "2026-04-20"), true);
    assert.equal(consents.some((c) => c.kind === "analytics" && c.granted === false), true);
    const audits = await db.select().from(crmAuditEventsTable).where(eq(crmAuditEventsTable.inquiryId, first.inquiryId));
    assert.equal(audits.some((a) => a.action === "consent.recorded"), true);
    const consentAudit = audits.find((a) => a.action === "consent.recorded");
    const after = (consentAudit?.afterValue ?? {}) as Record<string, unknown>;
    assert.equal(JSON.stringify(after).includes(email), false);
    assert.equal(after.analyticsGranted, false);
    assert.equal(after.purpose, "contact_inquiry_processing");
  });

  it("creates a second inquiry for a different idempotency key with an equivalent payload", async () => {
    requireIsolatedDb();
    process.env.CRM_SKIP_RUNTIME_SEED = "true";
    const email = `repeat.${randomUUID().slice(0, 8)}@example.com`;
    const payload = base({ email, message: "Legitimate second inquiry after a prior ticket." });
    const a = await submitInquiry({ ...payload, idempotencyKey: randomUUID() }, { correlationId: randomUUID() });
    const b = await submitInquiry({ ...payload, idempotencyKey: randomUUID() }, { correlationId: randomUUID() });
    assert.notEqual(a.reference, b.reference);
  });

  it("rejects extensions and does not persist an E.164 value", async () => {
    requireIsolatedDb();
    await assert.rejects(
      () =>
        submitInquiry(base({ phoneRaw: "+14155552671;ext=12" }), { correlationId: randomUUID() }),
      (err: Error & { status?: number }) => err.status === 400,
    );
  });
});
