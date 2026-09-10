import {
  db as defaultDb,
  crmConfigTable,
  crmMacrosTable,
  crmMeetingTypesTable,
  crmQualificationModelsTable,
  crmRoutingRulesTable,
  crmSlaPoliciesTable,
  crmTagsTable,
  crmTaxonomyTable,
  crmTemplateVersionsTable,
  crmTemplatesTable,
  crmWorkflowsTable,
  type DbSession,
} from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

/** Read the live version so publish cannot overwrite an intervening published row. */
export async function readLiveVersion(
  entityType: string,
  entityId: string,
  executor: DbSession = defaultDb,
): Promise<number | null> {
  const db = executor;
  if (entityType === "sla_policy") {
    const [row] = await db.select({ version: crmSlaPoliciesTable.version }).from(crmSlaPoliciesTable).where(eq(crmSlaPoliciesTable.id, entityId)).limit(1);
    return row?.version ?? null;
  }
  if (entityType === "qualification_model") {
    const [row] = await db.select({ version: crmQualificationModelsTable.version }).from(crmQualificationModelsTable).where(eq(crmQualificationModelsTable.id, entityId)).limit(1);
    return row?.version ?? null;
  }
  if (entityType === "workflow") {
    const [row] = await db.select({ version: crmWorkflowsTable.version }).from(crmWorkflowsTable).where(eq(crmWorkflowsTable.id, entityId)).limit(1);
    return row?.version ?? null;
  }
  return null;
}

/** Apply an approved change inside the caller's transaction. */
export async function applyPublishedChange(
  row: { entityType: string; entityId: string; afterValue: unknown },
  executor: DbSession = defaultDb,
): Promise<void> {
  const db = executor;
  const after = (row.afterValue ?? {}) as Record<string, unknown>;
  const { _governance: _g, ...value } = after;

  switch (row.entityType) {
    case "qualification_model": {
      const [current] = await db
        .select()
        .from(crmQualificationModelsTable)
        .where(eq(crmQualificationModelsTable.id, row.entityId))
        .limit(1);
      if (!current) throw Object.assign(new Error("Qualification model not found"), { status: 404 });
      await db
        .update(crmQualificationModelsTable)
        .set({ status: "archived" })
        .where(eq(crmQualificationModelsTable.id, current.id));
      await db.insert(crmQualificationModelsTable).values({
        key: current.key,
        name: typeof value.name === "string" ? value.name : current.name,
        version: current.version + 1,
        status: "published",
        thresholds: (value.thresholds as Record<string, number>) ?? current.thresholds,
        rules: (value.rules as Record<string, unknown>[]) ?? current.rules,
        publishedAt: new Date(),
      });
      return;
    }
    case "sla_policy": {
      await db
        .update(crmSlaPoliciesTable)
        .set({
          ...(typeof value.name === "string" ? { name: value.name } : {}),
          ...(typeof value.firstResponseMinutes === "number"
            ? { firstResponseMinutes: value.firstResponseMinutes }
            : {}),
          ...(typeof value.nextResponseMinutes === "number" || value.nextResponseMinutes === null
            ? { nextResponseMinutes: value.nextResponseMinutes as number | null }
            : {}),
          ...(typeof value.resolutionMinutes === "number" || value.resolutionMinutes === null
            ? { resolutionMinutes: value.resolutionMinutes as number | null }
            : {}),
          ...(Array.isArray(value.holidays) ? { holidays: value.holidays as string[] } : {}),
          ...(typeof value.timeZone === "string" ? { timeZone: value.timeZone } : {}),
          version: sql`${crmSlaPoliciesTable.version} + 1`,
        })
        .where(eq(crmSlaPoliciesTable.id, row.entityId));
      return;
    }
    case "routing_rule": {
      await db
        .update(crmRoutingRulesTable)
        .set({
          ...(typeof value.name === "string" ? { name: value.name } : {}),
          ...(typeof value.priority === "number" ? { priority: value.priority } : {}),
          ...(typeof value.strategy === "string" ? { strategy: value.strategy } : {}),
          ...(typeof value.status === "string" ? { status: value.status } : {}),
        })
        .where(eq(crmRoutingRulesTable.id, row.entityId));
      return;
    }
    case "workflow": {
      await db
        .update(crmWorkflowsTable)
        .set({
          ...(typeof value.name === "string" ? { name: value.name } : {}),
          ...(typeof value.status === "string" ? { status: value.status } : {}),
          version: sql`${crmWorkflowsTable.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(crmWorkflowsTable.id, row.entityId));
      return;
    }
    case "meeting_type": {
      await db
        .update(crmMeetingTypesTable)
        .set({
          ...(typeof value.name === "string" ? { name: value.name } : {}),
          ...(typeof value.bookingUrl === "string" ? { bookingUrl: value.bookingUrl } : {}),
          ...(typeof value.durationMinutes === "number" ? { durationMinutes: value.durationMinutes } : {}),
        })
        .where(eq(crmMeetingTypesTable.id, row.entityId));
      return;
    }
    case "taxonomy": {
      await db
        .update(crmTaxonomyTable)
        .set({
          ...(typeof value.label === "string" ? { label: value.label } : {}),
          ...(typeof value.sortOrder === "number" ? { sortOrder: value.sortOrder } : {}),
          ...(typeof value.active === "boolean" ? { active: value.active } : {}),
        })
        .where(eq(crmTaxonomyTable.id, row.entityId));
      return;
    }
    case "template_publish": {
      await db
        .update(crmTemplatesTable)
        .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(crmTemplatesTable.id, row.entityId));
      return;
    }
    case "template_version": {
      const [latest] = await db
        .select()
        .from(crmTemplateVersionsTable)
        .where(eq(crmTemplateVersionsTable.templateId, row.entityId))
        .orderBy(desc(crmTemplateVersionsTable.versionNumber))
        .limit(1);
      await db.insert(crmTemplateVersionsTable).values({
        templateId: row.entityId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        language: typeof value.language === "string" ? value.language : "en",
        subject: String(value.subject ?? ""),
        body: String(value.body ?? ""),
        changeSummary: typeof value.changeSummary === "string" ? value.changeSummary : "Governed version",
      });
      return;
    }
    case "macro": {
      await db
        .update(crmMacrosTable)
        .set({
          ...(typeof value.name === "string" ? { name: value.name } : {}),
          ...(typeof value.description === "string" ? { description: value.description } : {}),
          ...(typeof value.status === "string" ? { status: value.status } : {}),
          ...(Array.isArray(value.actions) ? { actions: value.actions as Record<string, unknown>[] } : {}),
        })
        .where(eq(crmMacrosTable.id, row.entityId));
      return;
    }
    case "tag": {
      await db
        .update(crmTagsTable)
        .set({
          ...(typeof value.label === "string" ? { label: value.label } : {}),
          ...(typeof value.color === "string" || value.color === null ? { color: value.color as string | null } : {}),
        })
        .where(eq(crmTagsTable.id, row.entityId));
      return;
    }
    case "notification_policy": {
      await db
        .insert(crmConfigTable)
        .values({
          key: "notification_policy",
          value: value as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: crmConfigTable.key,
          set: { value: value as Record<string, unknown>, updatedAt: new Date() },
        });
      return;
    }
    case "business_calendar":
    case "retention_policy":
    case "spam_bot_policy": {
      await db
        .insert(crmConfigTable)
        .values({
          key: row.entityType,
          value: value as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: crmConfigTable.key,
          set: { value: value as Record<string, unknown>, updatedAt: new Date() },
        });
      return;
    }
    case "template_create": {
      await db.insert(crmTemplatesTable).values({
        id: row.entityId,
        key: String(value.key),
        internalName: typeof value.internalName === "string" ? value.internalName : String(value.key),
        category: typeof value.category === "string" ? value.category : "general",
        status: "draft",
        createdBy: typeof value.createdBy === "string" ? value.createdBy : null,
      });
      await db.insert(crmTemplateVersionsTable).values({
        templateId: row.entityId,
        versionNumber: 1,
        language: typeof value.language === "string" ? value.language : "en",
        subject: String(value.subject ?? ""),
        body: String(value.body ?? ""),
        changedBy: typeof value.createdBy === "string" ? value.createdBy : null,
        changeSummary: "Governed create",
      });
      return;
    }
    default:
      throw Object.assign(new Error(`Cannot publish entity type ${row.entityType}`), { status: 400 });
  }
}
