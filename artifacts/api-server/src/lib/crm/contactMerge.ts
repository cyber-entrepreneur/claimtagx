import {
  db,
  crmAnalyticsEventsTable,
  crmAttachmentsTable,
  crmAuditEventsTable,
  crmConsentRecordsTable,
  crmContactMergesTable,
  crmContactsTable,
  crmDsarRequestsTable,
  crmInquiriesTable,
  crmLegalHoldsTable,
  crmMeetingsTable,
  crmMessagesTable,
  crmOpportunitiesTable,
  crmChannelIdentitiesTable,
  type DbSession,
  type JsonMap,
} from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";

export const CONTACT_MERGE_RELATIONSHIPS = [
  "inquiries.contact_id",
  "messages.author_contact_id",
  "consent_records.contact_id",
  "meetings.contact_id",
  "analytics_events.contact_id",
  "legal_holds.contact_id",
  "dsar_requests.contact_id",
  "attachments.contact_id",
  "opportunities.contact_id",
  "audit_events.contact_id (preserved; insert-only, not rewritten)",
  "conversations (via inquiry.contact_id; no direct contact_id)",
  "sla_instances (via inquiry_id; no direct contact_id)",
  "notifications (staff-scoped; no contact_id)",
  "saved_views.filters JSON (not rewritten; staff-owned views)",
  "external/provider identifiers (email_normalized uniqueness; crm_channel_identities rewritten on merge)",
  "unmerge (not supported: insert-only merge history + loser PII wipe)",
] as const;

export function planContactMerge(winnerId: string, loserId: string): {
  winnerId: string;
  loserId: string;
  loserEmail: string;
} {
  if (!winnerId || !loserId || winnerId === loserId) {
    throw Object.assign(new Error("Merge requires two distinct contact ids"), { status: 400 });
  }
  const [first, second] = winnerId < loserId ? [winnerId, loserId] : [loserId, winnerId];
  void first;
  void second;
  return {
    winnerId,
    loserId,
    loserEmail: `merged+${loserId.replace(/-/g, "").slice(0, 12)}@merged.invalid`,
  };
}

async function applyContactMergeInner(
  executor: DbSession,
  params: {
    winnerId: string;
    loserId: string;
    actorStaffId?: string;
    idempotencyKey: string;
    allowLegalHoldMerge?: boolean;
  },
): Promise<{ winnerId: string; loserId: string; replayed: boolean }> {
  const plan = planContactMerge(params.winnerId, params.loserId);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(plan.winnerId) || !uuidRe.test(plan.loserId)) {
    throw Object.assign(new Error("Invalid contact id"), { status: 400 });
  }
  const lockOrder = [plan.winnerId, plan.loserId].sort();
  await executor.execute(
    sql`SELECT id FROM crm_contacts WHERE id IN (${lockOrder[0]}::uuid, ${lockOrder[1]}::uuid) ORDER BY id FOR UPDATE`,
  );
  const [existing] = await executor
    .select()
    .from(crmContactMergesTable)
    .where(eq(crmContactMergesTable.idempotencyKey, params.idempotencyKey))
    .limit(1);
  if (existing) {
    if (existing.winnerId !== plan.winnerId || existing.loserId !== plan.loserId) {
      throw Object.assign(new Error("Idempotency key reused with a different merge payload"), { status: 409 });
    }
    return { winnerId: existing.winnerId, loserId: existing.loserId, replayed: true };
  }
  const [priorLoser] = await executor
    .select({ id: crmContactMergesTable.id })
    .from(crmContactMergesTable)
    .where(eq(crmContactMergesTable.loserId, plan.loserId))
    .limit(1);
  if (priorLoser) {
    throw Object.assign(new Error("Loser contact was already merged"), { status: 409 });
  }
  const [cycle] = await executor
    .select({ id: crmContactMergesTable.id })
    .from(crmContactMergesTable)
    .where(and(eq(crmContactMergesTable.winnerId, plan.loserId), eq(crmContactMergesTable.loserId, plan.winnerId)))
    .limit(1);
  if (cycle) {
    throw Object.assign(new Error("Merge would create a cycle"), { status: 409 });
  }

  const [winner] = await executor
    .select()
    .from(crmContactsTable)
    .where(eq(crmContactsTable.id, plan.winnerId))
    .limit(1);
  const [loser] = await executor
    .select()
    .from(crmContactsTable)
    .where(eq(crmContactsTable.id, plan.loserId))
    .limit(1);
  if (!winner || !loser) {
    throw Object.assign(new Error("Contact not found"), { status: 404 });
  }

  const openHolds = await executor
    .select()
    .from(crmLegalHoldsTable)
    .where(
      and(
        isNull(crmLegalHoldsTable.releasedAt),
        or(eq(crmLegalHoldsTable.contactId, plan.winnerId), eq(crmLegalHoldsTable.contactId, plan.loserId)),
      ),
    );
  if (openHolds.length && !params.allowLegalHoldMerge) {
    throw Object.assign(new Error("Active legal hold blocks merge"), { status: 409 });
  }

  const winnerConsents = await executor
    .select()
    .from(crmConsentRecordsTable)
    .where(eq(crmConsentRecordsTable.contactId, plan.winnerId));
  const loserConsents = await executor
    .select()
    .from(crmConsentRecordsTable)
    .where(eq(crmConsentRecordsTable.contactId, plan.loserId));
  for (const loserConsent of loserConsents) {
    const clash = winnerConsents.find(
      (row) =>
        row.kind === loserConsent.kind &&
        (row.granted !== loserConsent.granted || row.termsVersion !== loserConsent.termsVersion),
    );
    if (clash) {
      throw Object.assign(new Error("Consent conflict requires manual resolution"), { status: 409 });
    }
  }

  await executor.update(crmInquiriesTable).set({ contactId: plan.winnerId }).where(eq(crmInquiriesTable.contactId, plan.loserId));
  await executor.update(crmMessagesTable).set({ authorContactId: plan.winnerId }).where(eq(crmMessagesTable.authorContactId, plan.loserId));
  await executor.update(crmConsentRecordsTable).set({ contactId: plan.winnerId }).where(eq(crmConsentRecordsTable.contactId, plan.loserId));
  await executor.update(crmMeetingsTable).set({ contactId: plan.winnerId }).where(eq(crmMeetingsTable.contactId, plan.loserId));
  await executor.update(crmAnalyticsEventsTable).set({ contactId: plan.winnerId }).where(eq(crmAnalyticsEventsTable.contactId, plan.loserId));
  await executor.update(crmLegalHoldsTable).set({ contactId: plan.winnerId }).where(eq(crmLegalHoldsTable.contactId, plan.loserId));
  await executor.update(crmDsarRequestsTable).set({ contactId: plan.winnerId }).where(eq(crmDsarRequestsTable.contactId, plan.loserId));
  await executor.update(crmAttachmentsTable).set({ contactId: plan.winnerId }).where(eq(crmAttachmentsTable.contactId, plan.loserId));
  await executor.update(crmOpportunitiesTable).set({ contactId: plan.winnerId }).where(eq(crmOpportunitiesTable.contactId, plan.loserId));
  await executor.update(crmChannelIdentitiesTable).set({ contactId: plan.winnerId, updatedAt: new Date() }).where(eq(crmChannelIdentitiesTable.contactId, plan.loserId));

  await executor
    .update(crmContactsTable)
    .set({
      email: plan.loserEmail,
      emailNormalized: plan.loserEmail,
      firstName: "Merged",
      lastName: "Contact",
      jobTitle: "merged",
      phoneRaw: null,
      phoneE164: null,
      phoneNationalNumber: null,
      phoneCountry: null,
      phoneCountryCallingCode: null,
      updatedAt: new Date(),
    })
    .where(eq(crmContactsTable.id, plan.loserId));

  const snapshot: JsonMap = {
    winnerId: plan.winnerId,
    loserId: plan.loserId,
    loserEmail: plan.loserEmail,
    winnerEmail: winner.emailNormalized,
  };
  await executor.insert(crmContactMergesTable).values({
    winnerId: plan.winnerId,
    loserId: plan.loserId,
    idempotencyKey: params.idempotencyKey,
    plan: snapshot,
    actorStaffId: params.actorStaffId ?? null,
  });
  await executor.insert(crmAuditEventsTable).values({
    actorType: "staff",
    actorId: params.actorStaffId ?? null,
    action: "contact.merged",
    entityType: "contact",
    entityId: plan.winnerId,
    contactId: plan.winnerId,
    afterValue: snapshot,
  });
  return { winnerId: plan.winnerId, loserId: plan.loserId, replayed: false };
}

export async function applyContactMerge(params: {
  winnerId: string;
  loserId: string;
  actorStaffId?: string;
  idempotencyKey: string;
  allowLegalHoldMerge?: boolean;
  executor?: DbSession;
}): Promise<{ winnerId: string; loserId: string; replayed: boolean }> {
  if (params.executor) {
    return applyContactMergeInner(params.executor, params);
  }
  return db.transaction((tx) => applyContactMergeInner(tx, params));
}
