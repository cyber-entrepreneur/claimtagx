import {
  db,
  crmConfigChangesTable,
  crmConfigPublicationsTable,
  type DbSession,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import {
  auditPayloadForTransition,
  assertConfigSchema,
  buildRollbackSuccessor,
  nextConfigChangeStatus,
  permissionForEvent,
  type ConfigChangeEvent,
} from "./configLifecycle";
import { applyPublishedChange, readLiveVersion } from "./configPublish";
import { hasPermission, ROLE_PERMISSIONS, type PlatformPermission } from "./rbac";

export class ConfigConflictError extends Error {
  status = 409;
  code = "STALE_LOCK";
  currentLockVersion: number;
  currentStatus: string;
  currentPublishedVersion: number | null;
  constructor(params: {
    message: string;
    currentLockVersion: number;
    currentStatus: string;
    currentPublishedVersion?: number | null;
  }) {
    super(params.message);
    this.name = "ConfigConflictError";
    this.currentLockVersion = params.currentLockVersion;
    this.currentStatus = params.currentStatus;
    this.currentPublishedVersion = params.currentPublishedVersion ?? null;
  }
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      currentLockVersion: this.currentLockVersion,
      currentStatus: this.currentStatus,
      currentPublishedVersion: this.currentPublishedVersion,
    };
  }
}

export type ConfigActor = {
  id: string;
  role: string;
  permissions?: string[];
};

export async function applyConfigChangeAction(input: {
  changeId: string;
  action: ConfigChangeEvent;
  actor: ConfigActor;
  expectedLockVersion: number;
  expectedPublishedVersion?: number | null;
  rationale?: string;
  emergencyBypass?: boolean;
  emergencyReason?: string;
  correlationId?: string;
  failAfter?: "live_apply" | "before_audit";
}): Promise<{ change: typeof crmConfigChangesTable.$inferSelect; publicationId?: string }> {
  const needed = permissionForEvent(input.action);
  const granted =
    input.actor.permissions?.length ? input.actor.permissions : (ROLE_PERMISSIONS[input.actor.role] ?? []);
  if (!hasPermission(granted, needed as PlatformPermission)) {
    throw Object.assign(new Error(`Missing ${needed}`), { status: 403 });
  }
  if (!["submit_review", "approve", "reject", "publish", "rollback", "revise"].includes(input.action)) {
    throw Object.assign(new Error("Unknown action"), { status: 400 });
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(crmConfigChangesTable)
      .where(eq(crmConfigChangesTable.id, input.changeId))
      .limit(1);
    if (!row) throw Object.assign(new Error("Change not found"), { status: 404 });
    if (typeof input.expectedLockVersion !== "number") {
      throw Object.assign(new Error("expectedLockVersion is required"), { status: 400 });
    }
    if (input.expectedLockVersion !== row.lockVersion) {
      throw new ConfigConflictError({
        message: "Stale lock version. Refresh and retry.",
        currentLockVersion: row.lockVersion,
        currentStatus: row.status,
        currentPublishedVersion: row.publishedVersion,
      });
    }
    const afterValue = (row.afterValue ?? {}) as Record<string, unknown>;
    if (input.action === "publish" || input.emergencyBypass) {
      assertConfigSchema(row.entityType, afterValue);
    }
    const currentPub = await currentPublishedVersion(row.entityType, row.entityId, tx);
    if (input.action === "publish" || input.action === "rollback") {
      if (typeof input.expectedPublishedVersion !== "number") {
        throw Object.assign(new Error("expectedPublishedVersion is required"), { status: 400 });
      }
      const expectedPub = input.expectedPublishedVersion;
      const actualPub = currentPub?.publishedVersion ?? 0;
      if (expectedPub !== actualPub) {
        throw new ConfigConflictError({
          message: "Stale published version. Refresh and retry.",
          currentLockVersion: row.lockVersion,
          currentStatus: row.status,
          currentPublishedVersion: actualPub,
        });
      }
    }
    const liveVersion =
      input.action === "publish" || input.action === "rollback"
        ? await readLiveVersion(row.entityType, row.entityId, tx)
        : null;
    const next = nextConfigChangeStatus(
      {
        status: row.status as "draft",
        authorStaffId: row.authorStaffId ?? "",
        entityType: row.entityType,
      },
      input.action,
      {
        actorStaffId: input.actor.id,
        actorRole: input.actor.role,
        permissions: granted,
        expectedUpdatedAt: undefined,
        currentUpdatedAt: undefined,
        expectedLiveVersion: null,
        currentLiveVersion: null,
        afterValue,
        rationale: input.rationale,
        emergencyBypass: input.emergencyBypass,
        emergencyReason: input.emergencyReason,
        correlationId: input.correlationId,
      },
    );
    const correlationId = input.correlationId ?? row.id;
    const emergency = Boolean(input.emergencyBypass);
    let publishedVersion: number | null = null;
    let publicationId: string | undefined;
    let rollbackOfId: string | null = row.rollbackOfId;
    let supersedesId: string | null = row.supersedesId;

    if (input.action === "publish") {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${row.entityType}), hashtext(${row.entityId}))`,
      );
      const [latest] = await tx
        .select({ publishedVersion: crmConfigPublicationsTable.publishedVersion, id: crmConfigPublicationsTable.id })
        .from(crmConfigPublicationsTable)
        .where(
          and(
            eq(crmConfigPublicationsTable.entityType, row.entityType),
            eq(crmConfigPublicationsTable.entityId, row.entityId),
          ),
        )
        .orderBy(desc(crmConfigPublicationsTable.publishedVersion))
        .limit(1);
      publishedVersion = (latest?.publishedVersion ?? 0) + 1;
      supersedesId = latest?.id ?? null;
      await applyPublishedChange(row, tx);
      if (input.failAfter === "live_apply") {
        throw Object.assign(new Error("simulated failure after live apply"), { status: 500 });
      }
      const [pub] = await tx
        .insert(crmConfigPublicationsTable)
        .values({
          entityType: row.entityType,
          entityId: row.entityId,
          publishedVersion,
          changeId: row.id,
          supersedesId,
          rollbackOfId: null,
          beforeValue: row.beforeValue,
          afterValue: afterValue,
          authorStaffId: row.authorStaffId,
          reviewerStaffId: row.reviewerStaffId,
          publisherStaffId: input.actor.id,
          emergency,
          emergencyReason: input.emergencyReason ?? null,
          schemaVersion: row.schemaVersion,
          effectiveAt: row.effectiveAt,
        })
        .returning({ id: crmConfigPublicationsTable.id });
      publicationId = pub?.id;
    }

    if (input.action === "rollback") {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${row.entityType}), hashtext(${row.entityId}))`,
      );
      const successor = buildRollbackSuccessor({
        publishedChangeId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        restoredValue: (row.beforeValue ?? {}) as Record<string, unknown>,
        previousPublishedValue: row.afterValue as Record<string, unknown>,
        actorStaffId: input.actor.id,
        correlationId,
        nextVersion: 0,
      });
      const [latest] = await tx
        .select({
          publishedVersion: crmConfigPublicationsTable.publishedVersion,
          id: crmConfigPublicationsTable.id,
          changeId: crmConfigPublicationsTable.changeId,
          entityType: crmConfigPublicationsTable.entityType,
          entityId: crmConfigPublicationsTable.entityId,
        })
        .from(crmConfigPublicationsTable)
        .where(
          and(
            eq(crmConfigPublicationsTable.entityType, row.entityType),
            eq(crmConfigPublicationsTable.entityId, row.entityId),
          ),
        )
        .orderBy(desc(crmConfigPublicationsTable.publishedVersion))
        .limit(1);
      if (!latest || latest.changeId !== row.id) {
        throw new ConfigConflictError({
          message: "Rollback is only allowed on the current publication for this change",
          currentLockVersion: row.lockVersion,
          currentStatus: row.status,
          currentPublishedVersion: latest?.publishedVersion ?? null,
        });
      }
      if (latest.entityType !== row.entityType || latest.entityId !== row.entityId) {
        throw Object.assign(new Error("Cross-stream lineage is not allowed"), { status: 400 });
      }
      publishedVersion = (latest.publishedVersion ?? 0) + 1;
      await applyPublishedChange({ ...row, afterValue: successor.afterValue }, tx);
      const [pub] = await tx
        .insert(crmConfigPublicationsTable)
        .values({
          entityType: row.entityType,
          entityId: row.entityId,
          publishedVersion,
          changeId: row.id,
          supersedesId: latest.id,
          rollbackOfId: latest.id,
          beforeValue: successor.beforeValue,
          afterValue: successor.afterValue,
          authorStaffId: input.actor.id,
          publisherStaffId: input.actor.id,
          schemaVersion: row.schemaVersion,
        })
        .returning({ id: crmConfigPublicationsTable.id });
      publicationId = pub?.id;
      rollbackOfId = latest.id;
      const [successorRow] = await tx
        .insert(crmConfigChangesTable)
        .values({
          entityType: row.entityType,
          entityId: row.entityId,
          status: "published",
          summary: `Rollback of ${row.id}`,
          warnings: [],
          beforeValue: successor.beforeValue,
          afterValue: successor.afterValue,
          authorStaffId: input.actor.id,
          publisherStaffId: input.actor.id,
          publishedAt: new Date(),
          publishedVersion,
          rollbackOfPublicationId: latest.id,
          supersedesChangeId: row.id,
        })
        .returning();
      void successorRow;
    }

    const patch: Partial<typeof crmConfigChangesTable.$inferInsert> = {
      status: input.action === "rollback" ? "rolled_back" : next,
      updatedAt: new Date(),
      lockVersion: row.lockVersion + 1,
    };
    if (input.action === "approve") patch.reviewerStaffId = input.actor.id;
    if (input.action === "publish") {
      patch.publisherStaffId = input.actor.id;
      patch.publishedAt = new Date();
      patch.publishedVersion = publishedVersion;
      patch.supersedesId = supersedesId;
      patch.emergency = emergency;
      patch.emergencyReason = input.emergencyReason ?? null;
    }
    const locked = await tx
      .update(crmConfigChangesTable)
      .set(patch)
      .where(
        and(
          eq(crmConfigChangesTable.id, row.id),
          eq(crmConfigChangesTable.status, row.status),
          eq(crmConfigChangesTable.lockVersion, row.lockVersion),
        ),
      )
      .returning();
    if (locked.length === 0) {
      throw Object.assign(new Error("Change was updated concurrently. Refresh and retry."), { status: 409 });
    }
    if (input.failAfter === "before_audit") {
      throw Object.assign(new Error("simulated failure before audit"), { status: 500 });
    }
    const auditAfter = auditPayloadForTransition({
      action: emergency ? "emergency_publish" : input.action,
      actorStaffId: input.actor.id,
      changeId: row.id,
      fromStatus: row.status,
      toStatus: locked[0].status,
      beforeVersion: liveVersion,
      afterVersion: publishedVersion,
      rationale: emergency ? input.emergencyReason : input.rationale,
      correlationId,
      emergency,
    });
    await writeAudit(
      {
        actorType: "staff",
        actorId: input.actor.id,
        action: `config.change.${input.action}`,
        entityType: row.entityType,
        entityId: row.entityId,
        correlationId,
        afterValue: auditAfter,
      },
      tx,
    );
    return { change: locked[0], publicationId };
  });
}

export async function currentPublishedVersion(entityType: string, entityId: string, executor: DbSession = db) {
  const [row] = await executor
    .select()
    .from(crmConfigPublicationsTable)
    .where(
      and(eq(crmConfigPublicationsTable.entityType, entityType), eq(crmConfigPublicationsTable.entityId, entityId)),
    )
    .orderBy(desc(crmConfigPublicationsTable.publishedVersion))
    .limit(1);
  return row ?? null;
}
