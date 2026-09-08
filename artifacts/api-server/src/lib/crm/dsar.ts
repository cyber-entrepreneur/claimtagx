import { db, crmAttachmentsTable, crmDsarRequestsTable, crmOpportunitiesTable, type JsonMap } from "@workspace/db";
import {
  crmAnalyticsEventsTable,
  crmCompaniesTable,
  crmConsentRecordsTable,
  crmContactsTable,
  crmInquiriesTable,
  crmLegalHoldsTable,
  crmMeetingsTable,
  crmMessagesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { writeAudit } from "./audit";
import { anonymizeContact, exportDsarPackage } from "./governance";
import { normalizePhone } from "./phone";

const DSAR_TRANSITIONS: Record<string, string[]> = {
  intake: ["identity_pending", "rejected"],
  identity_pending: ["identity_verified", "rejected"],
  identity_verified: ["in_progress", "legal_review", "rejected"],
  in_progress: ["legal_review", "completed", "rejected"],
  legal_review: ["in_progress", "completed", "rejected"],
  completed: [],
  rejected: [],
};

export async function createDsarRequest(params: {
  contactId: string;
  requestType: "access" | "export" | "correction" | "deletion" | "objection";
  actorStaffId: string;
  notes?: string;
  dueAt?: Date;
}) {
  const [contact] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, params.contactId)).limit(1);
  if (!contact) throw Object.assign(new Error("Contact not found"), { status: 404 });
  const [row] = await db
    .insert(crmDsarRequestsTable)
    .values({
      contactId: params.contactId,
      companyId: contact.companyId,
      requestType: params.requestType,
      status: "intake",
      dueAt: params.dueAt ?? new Date(Date.now() + 30 * 24 * 60 * 60_000),
      notes: params.notes ?? null,
      createdByStaffId: params.actorStaffId,
    })
    .returning();
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "dsar.intake",
    entityType: "dsar_request",
    entityId: row.id,
    contactId: params.contactId,
    afterValue: { requestType: params.requestType },
  });
  return row;
}

export async function transitionDsarRequest(params: {
  id: string;
  status: string;
  actorStaffId: string;
  identityVerified?: boolean;
  legalExceptionReason?: string;
  rejectionReason?: string;
  ownerStaffId?: string;
}) {
  const [row] = await db.select().from(crmDsarRequestsTable).where(eq(crmDsarRequestsTable.id, params.id)).limit(1);
  if (!row) throw Object.assign(new Error("DSAR request not found"), { status: 404 });
  const allowed = DSAR_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(params.status)) {
    throw Object.assign(new Error(`Invalid DSAR transition ${row.status} → ${params.status}`), { status: 409 });
  }
  if (params.status === "identity_verified" && !params.identityVerified) {
    throw Object.assign(new Error("Identity verification is required before this transition"), { status: 400 });
  }
  if (params.status === "rejected" && !params.rejectionReason && !params.legalExceptionReason) {
    throw Object.assign(new Error("Rejection or legal exception reason is required"), { status: 400 });
  }
  const [updated] = await db
    .update(crmDsarRequestsTable)
    .set({
      status: params.status,
      identityVerifiedAt:
        params.status === "identity_verified" ? new Date() : row.identityVerifiedAt,
      legalExceptionReason: params.legalExceptionReason ?? row.legalExceptionReason,
      rejectionReason: params.rejectionReason ?? row.rejectionReason,
      ownerStaffId: params.ownerStaffId ?? row.ownerStaffId,
      completedAt: params.status === "completed" || params.status === "rejected" ? new Date() : row.completedAt,
      updatedAt: new Date(),
    })
    .where(eq(crmDsarRequestsTable.id, params.id))
    .returning();
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "dsar.transition",
    entityType: "dsar_request",
    entityId: params.id,
    contactId: row.contactId,
    beforeValue: { status: row.status },
    afterValue: { status: params.status },
  });
  return updated;
}

export async function completeDsarExport(params: { id: string; actorStaffId: string }) {
  const [row] = await db.select().from(crmDsarRequestsTable).where(eq(crmDsarRequestsTable.id, params.id)).limit(1);
  if (!row?.contactId) throw Object.assign(new Error("DSAR request not found"), { status: 404 });
  if (row.status !== "in_progress" && row.status !== "identity_verified") {
    throw Object.assign(new Error("DSAR must be in progress to export"), { status: 409 });
  }
  const pack = await exportDsarPackage(row.contactId, params.actorStaffId);
  const attachments = await db.select().from(crmAttachmentsTable).where(eq(crmAttachmentsTable.contactId, row.contactId));
  const opportunities = await db.select().from(crmOpportunitiesTable).where(eq(crmOpportunitiesTable.contactId, row.contactId));
  const meetings = await db.select().from(crmMeetingsTable).where(eq(crmMeetingsTable.contactId, row.contactId));
  const legalHolds = await db.select().from(crmLegalHoldsTable).where(eq(crmLegalHoldsTable.contactId, row.contactId));
  const company = row.companyId
    ? (await db.select().from(crmCompaniesTable).where(eq(crmCompaniesTable.id, row.companyId)).limit(1))[0]
    : null;
  const inquiries = await db.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.contactId, row.contactId));
  const inquiryIds = inquiries.map((i) => i.id);
  const messages =
    inquiryIds.length === 0
      ? []
      : await db.select({ id: crmMessagesTable.id }).from(crmMessagesTable).where(inArray(crmMessagesTable.inquiryId, inquiryIds));
  const consents = await db.select().from(crmConsentRecordsTable).where(eq(crmConsentRecordsTable.contactId, row.contactId));
  const analytics = await db
    .select({ id: crmAnalyticsEventsTable.id })
    .from(crmAnalyticsEventsTable)
    .where(eq(crmAnalyticsEventsTable.contactId, row.contactId));
  const manifest: JsonMap = {
    exportId: pack.exportId,
    exportedAt: new Date().toISOString(),
    coverage: {
      contact: true,
      company: Boolean(company),
      inquiries: inquiries.length,
      conversations: true,
      messages: messages.length,
      consent: consents.length,
      meetings: meetings.length,
      sla: true,
      tags: true,
      attachmentsMetadata: attachments.length,
      attachmentBytesIncluded: false,
      opportunities: opportunities.length,
      analytics: analytics.length,
      auditEvidence: true,
      legalHolds: legalHolds.length,
    },
    legalHoldActive: legalHolds.some((h) => !h.releasedAt),
    disclaimer:
      "Operational export of structured records only. Attachment bytes are referenced by metadata and are not packaged here. Not a legal-compliance certification.",
  };
  const [updated] = await db
    .update(crmDsarRequestsTable)
    .set({
      status: "completed",
      exportManifest: manifest,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(crmDsarRequestsTable.id, params.id))
    .returning();
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "dsar.export_completed",
    entityType: "dsar_request",
    entityId: params.id,
    contactId: row.contactId,
    afterValue: manifest,
  });
  return { request: updated, package: pack, manifest };
}

export async function listDsarRequests() {
  return db.select().from(crmDsarRequestsTable);
}

export async function applyDsarCorrection(params: {
  id: string;
  actorStaffId: string;
  patch: {
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    email?: string;
    phone?: string;
  };
}) {
  const [row] = await db.select().from(crmDsarRequestsTable).where(eq(crmDsarRequestsTable.id, params.id)).limit(1);
  if (!row?.contactId) throw Object.assign(new Error("DSAR request not found"), { status: 404 });
  if (row.requestType !== "correction") throw Object.assign(new Error("Not a correction request"), { status: 409 });
  if (row.status !== "in_progress") {
    throw Object.assign(new Error("DSAR must be in progress to correct"), { status: 409 });
  }
  const [contact] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, row.contactId)).limit(1);
  if (!contact) throw Object.assign(new Error("Contact not found"), { status: 404 });

  const email = params.patch.email?.trim().toLowerCase();
  const phonePatch =
    params.patch.phone !== undefined
      ? normalizePhone(params.patch.phone, contact.country || "US")
      : null;
  await db
    .update(crmContactsTable)
    .set({
      firstName: params.patch.firstName ?? contact.firstName,
      lastName: params.patch.lastName ?? contact.lastName,
      jobTitle: params.patch.jobTitle ?? contact.jobTitle,
      ...(email
        ? {
            email,
            emailNormalized: email,
          }
        : {}),
      ...(phonePatch
        ? {
            phoneRaw: phonePatch.phoneRaw || null,
            phoneE164: phonePatch.phoneE164,
            phoneNationalNumber: phonePatch.phoneNationalNumber || null,
            phoneCountryCallingCode: phonePatch.phoneCountryCallingCode || null,
            phoneValidationStatus: phonePatch.phoneValidationStatus,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(crmContactsTable.id, row.contactId));
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "dsar.correction_applied",
    entityType: "dsar_request",
    entityId: params.id,
    contactId: row.contactId,
    afterValue: {
      firstName: params.patch.firstName,
      lastName: params.patch.lastName,
      jobTitle: params.patch.jobTitle,
      emailChanged: Boolean(email),
      phoneChanged: Boolean(phonePatch),
    },
  });
  return transitionDsarRequest({ id: params.id, status: "completed", actorStaffId: params.actorStaffId });
}

export async function completeDsarDeletion(params: { id: string; actorStaffId: string }) {
  const [row] = await db.select().from(crmDsarRequestsTable).where(eq(crmDsarRequestsTable.id, params.id)).limit(1);
  if (!row?.contactId) throw Object.assign(new Error("DSAR request not found"), { status: 404 });
  if (row.requestType !== "deletion") throw Object.assign(new Error("Not a deletion request"), { status: 409 });
  if (row.status !== "in_progress") {
    throw Object.assign(new Error("DSAR must be in progress to delete"), { status: 409 });
  }
  const holds = await db.select().from(crmLegalHoldsTable).where(eq(crmLegalHoldsTable.contactId, row.contactId));
  if (holds.some((h) => !h.releasedAt)) {
    throw Object.assign(new Error("Legal hold blocks deletion"), { status: 409 });
  }
  await anonymizeContact(row.contactId, params.actorStaffId, `dsar deletion ${params.id}`);
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "dsar.deletion_completed",
    entityType: "dsar_request",
    entityId: params.id,
    contactId: row.contactId,
  });
  return transitionDsarRequest({ id: params.id, status: "completed", actorStaffId: params.actorStaffId });
}

/** Record and complete an objection (marketing/processing opt-out) without erasing the contact. */
export async function completeDsarObjection(params: {
  id: string;
  actorStaffId: string;
  notes?: string;
}) {
  const [row] = await db.select().from(crmDsarRequestsTable).where(eq(crmDsarRequestsTable.id, params.id)).limit(1);
  if (!row?.contactId) throw Object.assign(new Error("DSAR request not found"), { status: 404 });
  if (row.requestType !== "objection") throw Object.assign(new Error("Not an objection request"), { status: 409 });
  if (row.status !== "in_progress") {
    throw Object.assign(new Error("DSAR must be in progress to complete objection"), { status: 409 });
  }
  await db.insert(crmConsentRecordsTable).values({
    contactId: row.contactId,
    kind: "processing_objection",
    granted: false,
    termsVersion: null,
    privacyPolicyVersion: null,
    ip: null,
    userAgent: params.notes ?? "dsar_objection",
  });
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "dsar.objection_completed",
    entityType: "dsar_request",
    entityId: params.id,
    contactId: row.contactId,
    afterValue: { notes: params.notes ?? null },
  });
  return transitionDsarRequest({ id: params.id, status: "completed", actorStaffId: params.actorStaffId });
}
