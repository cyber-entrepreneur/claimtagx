import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("enterprise tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("DSAR attachments opportunities and webhook stored retry", () => {
  it("runs DSAR intake, identity boundary, export manifest, and rejection", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmContactsTable } = await import("@workspace/db");
    const dsar = await import("./dsar.ts");
    const [contact] = await db.select().from(crmContactsTable).limit(1);
    assert.ok(contact);
    const created = await dsar.createDsarRequest({
      contactId: contact.id,
      requestType: "export",
      actorStaffId: "staff-test",
    });
    await dsar.transitionDsarRequest({
      id: created.id,
      status: "identity_pending",
      actorStaffId: "staff-test",
    });
    await assert.rejects(() =>
      dsar.transitionDsarRequest({
        id: created.id,
        status: "identity_verified",
        actorStaffId: "staff-test",
      }),
    );
    await dsar.transitionDsarRequest({
      id: created.id,
      status: "identity_verified",
      actorStaffId: "staff-test",
      identityVerified: true,
    });
    await dsar.transitionDsarRequest({
      id: created.id,
      status: "in_progress",
      actorStaffId: "staff-test",
    });
    const exported = await dsar.completeDsarExport({ id: created.id, actorStaffId: "staff-test" });
    assert.equal(exported.request.status, "completed");
    assert.equal(exported.manifest.coverage.contact, true);
  });

  it("rejects executable attachments and accepts a PDF signature", async () => {
    requireIsolatedDb();
    const store = await import("./attachmentStore.ts");
    const exe = Buffer.from("MZ executable");
    await assert.rejects(() =>
      store.registerAttachment({
        meta: { filename: "x.exe", mimeType: "application/pdf", sizeBytes: exe.length },
        bytes: exe,
        visibility: "internal",
        actorStaffId: "staff-test",
      }),
    );
    const pdf = Buffer.from("%PDF-1.4 test");
    const row = await store.registerAttachment({
      meta: { filename: "note.pdf", mimeType: "application/pdf", sizeBytes: pdf.length },
      bytes: pdf,
      visibility: "internal",
      actorStaffId: "staff-test",
    });
    assert.equal(row.signatureOk, true);
  });

  it("converts an inquiry once and replays with the same idempotency key", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmContactsTable, crmInquiriesTable } = await import("@workspace/db");
    const { convertInquiryToOpportunity } = await import("./opportunities.ts");
    const [contact] = await db.select().from(crmContactsTable).limit(1);
    assert.ok(contact);
    const n = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-2026-${n}`,
        contactId: contact.id,
        inquiryType: "sales",
        source: "web",
      })
      .returning();
    assert.ok(inquiry);
    const key = `conv_${randomUUID()}`;
    const first = await convertInquiryToOpportunity({
      inquiryId: inquiry.id,
      actorStaffId: "staff-test",
      idempotencyKey: key,
      amountCents: 1000,
    });
    const second = await convertInquiryToOpportunity({
      inquiryId: inquiry.id,
      actorStaffId: "staff-test",
      idempotencyKey: key,
      amountCents: 1000,
    });
    assert.equal(second.replayed, true);
    assert.equal(second.opportunity.id, first.opportunity.id);
  });

  it("retries a stored webhook receipt without a second HTTP body from the provider", async () => {
    requireIsolatedDb();
    const inbound = await import("./inboundEmail.ts");
    const eventId = `evt_${randomUUID()}`;
    const raw = JSON.stringify({ from: "a@b.test", text: "hello", subject: "x" });
    await assert.rejects(() =>
      inbound.processInboundEmail({
        providerEventId: eventId,
        rawBody: raw,
        payload: { from: "a@b.test", text: "hello", subject: "x" },
        headers: {},
        failAfter: "receipt",
      }),
    );
    const n = await inbound.processDueStoredReceipts(20);
    assert.ok(n >= 1);
  });
});
