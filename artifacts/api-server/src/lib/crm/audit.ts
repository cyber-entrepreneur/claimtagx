import { db, crmAuditEventsTable, type JsonMap } from "@workspace/db";

export async function writeAudit(params: {
  actorType: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  inquiryId?: string | null;
  contactId?: string | null;
  beforeValue?: JsonMap | null;
  afterValue?: JsonMap | null;
  workflowId?: string | null;
  correlationId?: string | null;
}): Promise<void> {
  await db.insert(crmAuditEventsTable).values({
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    inquiryId: params.inquiryId ?? null,
    contactId: params.contactId ?? null,
    beforeValue: params.beforeValue ?? null,
    afterValue: params.afterValue ?? null,
    workflowId: params.workflowId ?? null,
    correlationId: params.correlationId ?? null,
  });
}
