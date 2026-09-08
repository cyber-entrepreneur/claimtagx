import { createHash, randomUUID } from "node:crypto";
import {
  db,
  crmAttachmentsTable,
  crmContactsTable,
  crmInquiriesTable,
  crmMessagesTable,
  crmConsentRecordsTable,
  crmLegalHoldsTable,
  crmAnalyticsEventsTable,
  crmContactMergesTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { writeAudit } from "./audit";
import { assertJobOwned, delayIfTestJob, type JobRunContext } from "./queue";
import { applyTransactionalDbEffect } from "./effects";
export {
  FIELD_CLASSIFICATION,
  staffCanViewPii,
  buildCorrectionRequest,
  redactContactForRole,
  type DataClass,
} from "./governancePolicy";

export interface RetentionPolicy {
  key: string;
  entity: "inquiry" | "message" | "audit" | "analytics";
  retainDays: number;
  action: "anonymize" | "delete";
}

export const DEFAULT_RETENTION: RetentionPolicy[] = [
  { key: "closed_inquiries", entity: "inquiry", retainDays: 365 * 3, action: "anonymize" },
  { key: "audit_events", entity: "audit", retainDays: 365 * 7, action: "delete" },
];

export async function exportDsarPackage(contactId: string, actorStaffId: string) {
  const [mergedFrom] = await db
    .select()
    .from(crmContactMergesTable)
    .where(eq(crmContactMergesTable.loserId, contactId))
    .limit(1);
  const resolvedId = mergedFrom?.winnerId ?? contactId;
  const [contact] = await db
    .select()
    .from(crmContactsTable)
    .where(eq(crmContactsTable.id, resolvedId))
    .limit(1);
  if (!contact) throw Object.assign(new Error("Contact not found"), { status: 404 });
  contactId = resolvedId;

  const inquiries = await db
    .select()
    .from(crmInquiriesTable)
    .where(eq(crmInquiriesTable.contactId, contactId));
  const inquiryIds = inquiries.map((i) => i.id);
  const messages =
    inquiryIds.length === 0
      ? []
      : await db
          .select()
          .from(crmMessagesTable)
          .where(inArray(crmMessagesTable.inquiryId, inquiryIds));
  const consents = await db
    .select()
    .from(crmConsentRecordsTable)
    .where(eq(crmConsentRecordsTable.contactId, contactId));

  const attachmentRows =
    inquiryIds.length === 0
      ? await db.select().from(crmAttachmentsTable).where(eq(crmAttachmentsTable.contactId, contactId))
      : await db
          .select()
          .from(crmAttachmentsTable)
          .where(
            or(eq(crmAttachmentsTable.contactId, contactId), inArray(crmAttachmentsTable.inquiryId, inquiryIds))!,
          );

  const { resolveObjectStoreFromEnv } = await import("./attachmentStore");
  const store = resolveObjectStoreFromEnv();
  const MAX_INLINE_BYTES = 2 * 1024 * 1024;
  const attachmentManifest = [];
  const attachmentFiles: Array<{ id: string; filename: string; sha256: string; bytesBase64: string }> = [];
  const usedNames = new Map<string, number>();
  function collisionSafeName(raw: string): string {
    const base = raw.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "attachment.bin";
    const n = usedNames.get(base.toLowerCase()) ?? 0;
    usedNames.set(base.toLowerCase(), n + 1);
    if (n === 0) return base;
    const dot = base.lastIndexOf(".");
    if (dot <= 0) return `${base}-${n}`;
    return `${base.slice(0, dot)}-${n}${base.slice(dot)}`;
  }
  for (const row of attachmentRows) {
    const quarantined = row.malwareStatus === "quarantined" || row.malwareStatus === "malicious";
    const unavailable = Boolean(row.deletedAt || row.tombstonedAt);
    const safeName = collisionSafeName(row.filename);
    const entry: Record<string, unknown> = {
      id: row.id,
      inquiryId: row.inquiryId,
      conversationId: (row as { conversationId?: string | null }).conversationId ?? null,
      filename: row.filename,
      exportFilename: safeName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      declaredSha256: row.sha256,
      sha256: row.sha256,
      malwareStatus: row.malwareStatus,
      legalHold: row.legalHold,
      deleted: unavailable,
      bytesIncluded: false,
      inclusion: "metadata_only",
    };
    if (quarantined) {
      entry.inclusion = "quarantine_manifest_only";
      entry.reason = "Quarantined or malicious bytes are never packaged in a normal DSAR download.";
    } else if (unavailable) {
      entry.inclusion = "unavailable";
      entry.reason = "Object deleted, tombstoned, or otherwise unavailable.";
    } else if (row.malwareStatus !== "clean") {
      entry.inclusion = "pending_scan";
      entry.reason = "Bytes withheld until malware status is clean.";
    } else if (row.legalHold) {
      entry.inclusion = "legal_hold_metadata_only";
      entry.reason = "Legal hold: bytes require the governed exception path, not the normal export download.";
    } else {
      try {
        if (process.env.CRM_TEST_DSAR_PROVIDER === "timeout") {
          throw Object.assign(new Error("provider timeout"), { code: "ETIMEDOUT" });
        }
        const bytes = await store.get(row.storageKey);
        if (!bytes) {
          entry.inclusion = "missing_object";
          entry.reason = "Storage get returned empty.";
        } else {
          const digest = createHash("sha256").update(bytes).digest("hex");
          entry.observedSha256 = digest;
          if (row.sha256 && row.sha256 !== digest) {
            entry.inclusion = "checksum_mismatch";
            entry.reason = "Declared checksum does not match observed bytes; bytes withheld.";
          } else if (bytes.byteLength > MAX_INLINE_BYTES) {
            entry.inclusion = "stream_deferred";
            entry.reason = `Object larger than ${MAX_INLINE_BYTES} bytes; listed for streaming retrieval.`;
          } else {
            entry.bytesIncluded = true;
            entry.inclusion = "inline_clean";
            attachmentFiles.push({
              id: row.id,
              filename: safeName,
              sha256: digest,
              bytesBase64: Buffer.from(bytes).toString("base64"),
            });
          }
        }
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
        if (code === "ETIMEDOUT" || /timeout/i.test(err instanceof Error ? err.message : "")) {
          entry.inclusion = "provider_timeout";
          entry.reason = "Attachment provider timed out; bytes withheld.";
        } else {
          entry.inclusion = "provider_failure";
          entry.reason = "provider_failure";
        }
      }
    }
    attachmentManifest.push(entry);
  }

  const payload = {
    exportId: randomUUID(),
    exportedAt: new Date().toISOString(),
    disclaimer:
      "Operational DSAR package. Not a statutory-compliance certification. Quarantined bytes are never inlined.",
    contact,
    inquiries,
    messages: messages.map((m) => ({
      id: m.id,
      inquiryId: m.inquiryId,
      conversationId: m.conversationId,
      kind: m.kind,
      visibility: m.visibility,
      subject: m.subject,
      body: m.body,
      createdAt: m.createdAt,
    })),
    consents,
    merge: mergedFrom
      ? { requestedContactId: mergedFrom.loserId, survivingContactId: mergedFrom.winnerId }
      : null,
    attachments: {
      manifest: attachmentManifest,
      files: attachmentFiles,
    },
    policyHash: createHash("sha256")
      .update(JSON.stringify({ terms: "2026-04-20", privacy: "2026-04-20" }))
      .digest("hex"),
  };

  await writeAudit({
    actorType: "staff",
    actorId: actorStaffId,
    action: "governance.dsar_export",
    entityType: "contact",
    entityId: contactId,
    contactId,
    afterValue: {
      exportId: payload.exportId,
      inquiryCount: inquiries.length,
      attachmentCount: attachmentManifest.length,
      inlinedFiles: attachmentFiles.length,
    },
  });

  return payload;
}

export async function anonymizeContact(
  contactId: string,
  actorStaffId: string,
  reason: string,
) {
  const activeHolds = await db
    .select({ id: crmLegalHoldsTable.id })
    .from(crmLegalHoldsTable)
    .where(and(eq(crmLegalHoldsTable.contactId, contactId), isNull(crmLegalHoldsTable.releasedAt)))
    .limit(1);
  if (activeHolds.length) {
    throw Object.assign(new Error("Legal hold blocks anonymization"), { status: 409 });
  }

  const token = `anon-${randomUUID().slice(0, 12)}`;
  const [updated] = await db
    .update(crmContactsTable)
    .set({
      firstName: "Anonymized",
      lastName: "Contact",
      email: `${token}@anonymized.invalid`,
      emailNormalized: `${token}@anonymized.invalid`,
      phoneRaw: null,
      phoneE164: null,
      phoneNationalNumber: null,
      phoneCountryCallingCode: null,
      phoneValidationStatus: "empty",
      updatedAt: new Date(),
    })
    .where(eq(crmContactsTable.id, contactId))
    .returning();
  if (!updated) throw Object.assign(new Error("Contact not found"), { status: 404 });

  const inquiries = await db
    .select({ id: crmInquiriesTable.id })
    .from(crmInquiriesTable)
    .where(eq(crmInquiriesTable.contactId, contactId));
  const inquiryIds = inquiries.map((i) => i.id);
  if (inquiryIds.length) {
    await db
      .update(crmMessagesTable)
      .set({
        body: "[redacted under privacy request]",
        bodyHtml: null,
        sanitizedHtml: null,
        textBody: null,
        subject: null,
      })
      .where(inArray(crmMessagesTable.inquiryId, inquiryIds));
  }
  await db
    .update(crmAttachmentsTable)
    .set({
      filename: "redacted.bin",
      malwareReason: "redacted_under_privacy_request",
      deletedAt: new Date(),
    })
    .where(eq(crmAttachmentsTable.contactId, contactId));
  await db
    .update(crmConsentRecordsTable)
    .set({
      granted: false,
      ip: null,
      userAgent: null,
    })
    .where(eq(crmConsentRecordsTable.contactId, contactId));
  await db.delete(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.contactId, contactId));

  await writeAudit({
    actorType: "staff",
    actorId: actorStaffId,
    action: "governance.anonymize",
    entityType: "contact",
    entityId: contactId,
    contactId,
    afterValue: { reason },
  });
  return updated;
}

async function syncAttachmentLegalHold(params: {
  contactId?: string | null;
  inquiryId?: string | null;
  held: boolean;
}) {
  if (params.contactId) {
    await db
      .update(crmAttachmentsTable)
      .set({ legalHold: params.held })
      .where(eq(crmAttachmentsTable.contactId, params.contactId));
  }
  if (params.inquiryId) {
    await db
      .update(crmAttachmentsTable)
      .set({ legalHold: params.held })
      .where(eq(crmAttachmentsTable.inquiryId, params.inquiryId));
  }
}

export async function placeLegalHold(params: {
  contactId?: string;
  inquiryId?: string;
  reason: string;
  actorStaffId: string;
}) {
  if (!params.contactId && !params.inquiryId) {
    throw Object.assign(new Error("contactId or inquiryId is required"), { status: 400 });
  }
  const [row] = await db
    .insert(crmLegalHoldsTable)
    .values({
      contactId: params.contactId ?? null,
      inquiryId: params.inquiryId ?? null,
      reason: params.reason,
      createdBy: params.actorStaffId,
    })
    .returning();
  await syncAttachmentLegalHold({
    contactId: params.contactId,
    inquiryId: params.inquiryId,
    held: true,
  });
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "governance.legal_hold",
    entityType: params.contactId ? "contact" : "inquiry",
    entityId: params.contactId ?? params.inquiryId ?? "",
    contactId: params.contactId,
    inquiryId: params.inquiryId,
    afterValue: { reason: params.reason },
  });
  return row;
}

export async function releaseLegalHold(holdId: string, actorStaffId: string) {
  const [updated] = await db
    .update(crmLegalHoldsTable)
    .set({ releasedAt: new Date() })
    .where(and(eq(crmLegalHoldsTable.id, holdId), isNull(crmLegalHoldsTable.releasedAt)))
    .returning();
  if (!updated) throw Object.assign(new Error("Hold not found"), { status: 404 });
  const holdMatchers = [];
  if (updated.contactId) holdMatchers.push(eq(crmLegalHoldsTable.contactId, updated.contactId));
  if (updated.inquiryId) holdMatchers.push(eq(crmLegalHoldsTable.inquiryId, updated.inquiryId));
  const remaining =
    holdMatchers.length === 0
      ? []
      : await db
          .select({ id: crmLegalHoldsTable.id })
          .from(crmLegalHoldsTable)
          .where(and(isNull(crmLegalHoldsTable.releasedAt), or(...holdMatchers)))
          .limit(1);
  if (!remaining.length) {
    await syncAttachmentLegalHold({
      contactId: updated.contactId,
      inquiryId: updated.inquiryId,
      held: false,
    });
  }
  await writeAudit({
    actorType: "staff",
    actorId: actorStaffId,
    action: "governance.legal_hold_release",
    entityType: "legal_hold",
    entityId: holdId,
  });
  return updated;
}

async function isOnLegalHold(contactId: string, inquiryId: string): Promise<boolean> {
  const rows = await db
    .select({
      id: crmLegalHoldsTable.id,
      contactId: crmLegalHoldsTable.contactId,
      inquiryId: crmLegalHoldsTable.inquiryId,
    })
    .from(crmLegalHoldsTable)
    .where(isNull(crmLegalHoldsTable.releasedAt));
  return rows.some((h) => h.contactId === contactId || h.inquiryId === inquiryId);
}

/** Enforce retention for closed inquiries older than retainDays (anonymize contact linkage messages). */
export async function enforceInquiryRetention(retainDays = 365 * 3, run?: JobRunContext): Promise<number> {
  if (run) {
    await assertJobOwned(run);
    await delayIfTestJob(run);
    await assertJobOwned(run);
  }
  const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60_000);
  const stale = await db
    .select({ id: crmInquiriesTable.id, contactId: crmInquiriesTable.contactId })
    .from(crmInquiriesTable)
    .where(
      and(
        eq(crmInquiriesTable.status, "CLOSED"),
        lte(crmInquiriesTable.closedAt, cutoff),
      ),
    )
    .limit(100);
  let count = 0;
  for (const row of stale) {
    if (run) await assertJobOwned(run);
    if (await isOnLegalHold(row.contactId, row.id)) continue;
    const key = `retention:${row.id}`;
    await applyTransactionalDbEffect({
      key,
      kind: "retention",
      payload: { inquiryId: row.id },
      ctx: run,
      work: async (tx) => {
        await tx
          .update(crmMessagesTable)
          .set({
            body: "[redacted under retention policy]",
            bodyHtml: null,
            sanitizedHtml: null,
            textBody: null,
          })
          .where(eq(crmMessagesTable.inquiryId, row.id));
      },
    });
    count += 1;
  }
  return count;
}
