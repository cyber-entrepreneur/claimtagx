import { db, crmConfigChangesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { writeAudit } from "./audit";
import {
  dryRunForEntity,
  isGovernedEntityType,
  summarizeImpact,
  assertConfigSchema,
} from "./configLifecycle";

export async function createGovernedDraft(input: {
  entityType: string;
  entityId: string;
  afterValue: Record<string, unknown>;
  beforeValue?: Record<string, unknown> | null;
  authorStaffId: string;
  correlationId?: string;
  rationale?: string;
  effectiveAt?: Date | null;
  baseVersion?: number | null;
}) {
  if (!isGovernedEntityType(input.entityType)) {
    throw Object.assign(new Error(`Entity type ${input.entityType} is not governed`), { status: 400 });
  }
  assertConfigSchema(input.entityType, input.afterValue);
  const warnings = dryRunForEntity(input.entityType, input.afterValue);
  const summary = summarizeImpact({
    entityType: input.entityType,
    before: input.beforeValue ?? null,
    after: input.afterValue,
  });
  const [row] = await db
    .insert(crmConfigChangesTable)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      status: "draft",
      summary,
      warnings,
      beforeValue: input.beforeValue ?? null,
      afterValue: {
        ...input.afterValue,
        _governance: {
          rationale: input.rationale ?? null,
          correlationId: input.correlationId ?? null,
          baseVersion: input.baseVersion ?? null,
        },
      },
      authorStaffId: input.authorStaffId,
      effectiveAt: input.effectiveAt ?? null,
    })
    .returning();
  await writeAudit({
    actorType: "staff",
    actorId: input.authorStaffId,
    action: "config.change.drafted",
    entityType: input.entityType,
    entityId: input.entityId,
    correlationId: input.correlationId,
    afterValue: { changeId: row.id, summary, rationale: input.rationale ?? null },
  });
  return row;
}

export async function loadChange(id: string) {
  const [row] = await db.select().from(crmConfigChangesTable).where(eq(crmConfigChangesTable.id, id)).limit(1);
  return row ?? null;
}
