import { and, eq, lt, sql } from "drizzle-orm";
import {
  db,
  crmRecordLocksTable,
  crmRecordPresenceTable,
  crmStaffTable,
  type DbSession,
} from "@workspace/db";
import { writeAudit } from "./audit";

/**
 * Advisory presence + exclusive edit-lease locking for concurrently editable records.
 *
 * IMPORTANT: this is advisory UX only. Optimistic concurrency (lockVersion /
 * expectedUpdatedAt CAS on the underlying entity) remains the authoritative
 * conflict guard for writes — a stolen or expired lock never blocks a save,
 * it only signals to the UI who is (or was) editing.
 */

export const RECORD_LOCK_ENTITY_TYPES = ["inquiry", "marketing_version", "config_change"] as const;
export type RecordLockEntityType = (typeof RECORD_LOCK_ENTITY_TYPES)[number];

export type RecordLock = typeof crmRecordLocksTable.$inferSelect;
export type RecordPresence = typeof crmRecordPresenceTable.$inferSelect;

export function isRecordLockEntityType(value: string): value is RecordLockEntityType {
  return (RECORD_LOCK_ENTITY_TYPES as readonly string[]).includes(value);
}

export function defaultLockTtlMs(): number {
  const n = Number(process.env.CRM_RECORD_LOCK_TTL_MS ?? 45_000);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

export function defaultPresenceStaleMs(): number {
  const n = Number(process.env.CRM_RECORD_PRESENCE_STALE_MS ?? 90_000);
  return Number.isFinite(n) && n > 0 ? n : 90_000;
}

export class RecordLockConflictError extends Error {
  status = 409;
  code = "RECORD_LOCKED";
  holder: { staffId: string; staffName?: string | null; leaseExpiresAt: Date } | null;
  constructor(message: string, holder: RecordLockConflictError["holder"]) {
    super(message);
    this.name = "RecordLockConflictError";
    this.holder = holder;
  }
}

/**
 * Acquire (or renew) an exclusive edit lease for an entity.
 * Succeeds when: no lock exists, the existing lock is expired, or the caller
 * already holds it. Otherwise throws a 409 RecordLockConflictError describing
 * the current holder so the UI can show "Currently edited by ...".
 */
export async function acquireLock(
  params: {
    entityType: RecordLockEntityType;
    entityId: string;
    staffId: string;
    ttlMs?: number;
    intent?: string;
  },
  executor: DbSession = db,
): Promise<RecordLock> {
  const ttlMs = params.ttlMs ?? defaultLockTtlMs();
  const intent = params.intent ?? "edit";
  const result = await executor.execute(sql`
    INSERT INTO crm_record_locks (entity_type, entity_id, staff_id, intent, lease_expires_at, lock_generation)
    VALUES (${params.entityType}, ${params.entityId}, ${params.staffId}, ${intent}, NOW() + (${ttlMs}::bigint * interval '1 millisecond'), 1)
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      staff_id = EXCLUDED.staff_id,
      intent = EXCLUDED.intent,
      lease_expires_at = EXCLUDED.lease_expires_at,
      lock_generation = crm_record_locks.lock_generation + 1,
      updated_at = now()
    WHERE crm_record_locks.lease_expires_at < now() OR crm_record_locks.staff_id = ${params.staffId}
    RETURNING *
  `);
  const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  if (rows[0]) {
    return mapLockRow(rows[0]);
  }
  const [holder] = await executor
    .select()
    .from(crmRecordLocksTable)
    .where(and(eq(crmRecordLocksTable.entityType, params.entityType), eq(crmRecordLocksTable.entityId, params.entityId)))
    .limit(1);
  const [holderStaff] = holder
    ? await executor.select({ name: crmStaffTable.name }).from(crmStaffTable).where(eq(crmStaffTable.id, holder.staffId)).limit(1)
    : [undefined];
  throw new RecordLockConflictError(
    "This record is currently being edited by another user.",
    holder ? { staffId: holder.staffId, staffName: holderStaff?.name ?? null, leaseExpiresAt: holder.leaseExpiresAt } : null,
  );
}

/** Renew an existing lease. Fails (409) if the caller no longer owns the lock. */
export async function heartbeatLock(
  params: { lockId: string; staffId: string; ttlMs?: number },
  executor: DbSession = db,
): Promise<RecordLock> {
  const ttlMs = params.ttlMs ?? defaultLockTtlMs();
  const [row] = await executor
    .update(crmRecordLocksTable)
    .set({ leaseExpiresAt: new Date(Date.now() + ttlMs), updatedAt: new Date() })
    .where(and(eq(crmRecordLocksTable.id, params.lockId), eq(crmRecordLocksTable.staffId, params.staffId)))
    .returning();
  if (!row) {
    throw Object.assign(new Error("Lock not found or no longer held by you"), {
      status: 409,
      code: "LOCK_LOST",
    });
  }
  return row;
}

/** Release a lock. Idempotent — releasing a lock you don't hold (or that doesn't exist) is a no-op. */
export async function releaseLock(
  params: { lockId: string; staffId: string },
  executor: DbSession = db,
): Promise<{ released: boolean }> {
  const deleted = await executor
    .delete(crmRecordLocksTable)
    .where(and(eq(crmRecordLocksTable.id, params.lockId), eq(crmRecordLocksTable.staffId, params.staffId)))
    .returning({ id: crmRecordLocksTable.id });
  return { released: deleted.length > 0 };
}

/** Release a lock by entity (used on unmount/disconnect when the lock id isn't at hand). */
export async function releaseLockByEntity(
  params: { entityType: RecordLockEntityType; entityId: string; staffId: string },
  executor: DbSession = db,
): Promise<{ released: boolean }> {
  const deleted = await executor
    .delete(crmRecordLocksTable)
    .where(
      and(
        eq(crmRecordLocksTable.entityType, params.entityType),
        eq(crmRecordLocksTable.entityId, params.entityId),
        eq(crmRecordLocksTable.staffId, params.staffId),
      ),
    )
    .returning({ id: crmRecordLocksTable.id });
  return { released: deleted.length > 0 };
}

const OVERRIDE_PERMISSIONS = ["config.manage", "inquiries.assign"] as const;

/**
 * Forcibly take over an active lock. Requires config.manage or inquiries.assign
 * and a reason of at least 5 characters. Always audited (immutable audit log).
 */
export async function overrideLock(
  params: {
    entityType: RecordLockEntityType;
    entityId: string;
    staffId: string;
    reason: string;
    permissions: string[];
    ttlMs?: number;
  },
  executor: DbSession = db,
): Promise<RecordLock> {
  const reason = params.reason.trim();
  if (reason.length < 5) {
    throw Object.assign(new Error("Override reason must be at least 5 characters"), { status: 400 });
  }
  if (!OVERRIDE_PERMISSIONS.some((p) => params.permissions.includes(p))) {
    throw Object.assign(new Error("Insufficient permission to override a record lock"), { status: 403 });
  }
  const ttlMs = params.ttlMs ?? defaultLockTtlMs();
  const [before] = await executor
    .select()
    .from(crmRecordLocksTable)
    .where(and(eq(crmRecordLocksTable.entityType, params.entityType), eq(crmRecordLocksTable.entityId, params.entityId)))
    .limit(1);
  const result = await executor.execute(sql`
    INSERT INTO crm_record_locks (entity_type, entity_id, staff_id, intent, lease_expires_at, lock_generation)
    VALUES (${params.entityType}, ${params.entityId}, ${params.staffId}, 'edit', NOW() + (${ttlMs}::bigint * interval '1 millisecond'), 1)
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      staff_id = EXCLUDED.staff_id,
      intent = 'edit',
      lease_expires_at = EXCLUDED.lease_expires_at,
      lock_generation = crm_record_locks.lock_generation + 1,
      updated_at = now()
    RETURNING *
  `);
  const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  const row = mapLockRow(rows[0]!);
  await writeAudit(
    {
      actorType: "staff",
      actorId: params.staffId,
      action: "record_lock.override",
      entityType: params.entityType,
      entityId: params.entityId,
      beforeValue: before ? { staffId: before.staffId, leaseExpiresAt: before.leaseExpiresAt.toISOString() } : null,
      afterValue: { staffId: params.staffId, reason },
    },
    executor,
  );
  return row;
}

/** Upsert a presence heartbeat row (does not grant/require the edit lock). */
export async function heartbeatPresence(
  params: { entityType: RecordLockEntityType; entityId: string; staffId: string; intent?: string },
  executor: DbSession = db,
): Promise<RecordPresence> {
  const [row] = await executor
    .insert(crmRecordPresenceTable)
    .values({
      entityType: params.entityType,
      entityId: params.entityId,
      staffId: params.staffId,
      intent: params.intent ?? "view",
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [crmRecordPresenceTable.staffId, crmRecordPresenceTable.entityType, crmRecordPresenceTable.entityId],
      set: { lastSeenAt: new Date(), intent: params.intent ?? "view" },
    })
    .returning();
  return row!;
}

export type PresenceSnapshot = {
  viewers: Array<{ staffId: string; staffName: string | null; intent: string; lastSeenAt: string }>;
  lock: {
    id: string;
    staffId: string;
    staffName: string | null;
    intent: string;
    leaseExpiresAt: string;
    active: boolean;
  } | null;
};

/** List active viewers + the current lock holder (if any) for an entity. */
export async function listPresence(
  params: { entityType: RecordLockEntityType; entityId: string; staleMs?: number },
  executor: DbSession = db,
): Promise<PresenceSnapshot> {
  const staleMs = params.staleMs ?? defaultPresenceStaleMs();
  const staleCutoff = new Date(Date.now() - staleMs);
  const rows = await executor
    .select({
      staffId: crmRecordPresenceTable.staffId,
      staffName: crmStaffTable.name,
      intent: crmRecordPresenceTable.intent,
      lastSeenAt: crmRecordPresenceTable.lastSeenAt,
    })
    .from(crmRecordPresenceTable)
    .innerJoin(crmStaffTable, eq(crmStaffTable.id, crmRecordPresenceTable.staffId))
    .where(
      and(
        eq(crmRecordPresenceTable.entityType, params.entityType),
        eq(crmRecordPresenceTable.entityId, params.entityId),
      ),
    );
  const viewers = rows
    .filter((r) => r.lastSeenAt.getTime() >= staleCutoff.getTime())
    .map((r) => ({
      staffId: r.staffId,
      staffName: r.staffName,
      intent: r.intent,
      lastSeenAt: r.lastSeenAt.toISOString(),
    }));
  const [lockRow] = await executor
    .select({
      id: crmRecordLocksTable.id,
      staffId: crmRecordLocksTable.staffId,
      staffName: crmStaffTable.name,
      intent: crmRecordLocksTable.intent,
      leaseExpiresAt: crmRecordLocksTable.leaseExpiresAt,
    })
    .from(crmRecordLocksTable)
    .innerJoin(crmStaffTable, eq(crmStaffTable.id, crmRecordLocksTable.staffId))
    .where(
      and(
        eq(crmRecordLocksTable.entityType, params.entityType),
        eq(crmRecordLocksTable.entityId, params.entityId),
      ),
    )
    .limit(1);
  return {
    viewers,
    lock: lockRow
      ? {
          id: lockRow.id,
          staffId: lockRow.staffId,
          staffName: lockRow.staffName,
          intent: lockRow.intent,
          leaseExpiresAt: lockRow.leaseExpiresAt.toISOString(),
          active: lockRow.leaseExpiresAt.getTime() > Date.now(),
        }
      : null,
  };
}

/** Sweep stale presence rows and long-expired locks. Safe to run periodically or via a job. */
export async function cleanupExpired(
  params?: { presenceStaleMs?: number; lockGraceMs?: number },
  executor: DbSession = db,
): Promise<{ presenceRemoved: number; locksRemoved: number }> {
  const presenceStaleMs = params?.presenceStaleMs ?? defaultPresenceStaleMs();
  const lockGraceMs = params?.lockGraceMs ?? 60_000;
  const presenceCutoff = new Date(Date.now() - presenceStaleMs);
  const lockCutoff = new Date(Date.now() - lockGraceMs);
  const removedPresence = await executor
    .delete(crmRecordPresenceTable)
    .where(lt(crmRecordPresenceTable.lastSeenAt, presenceCutoff))
    .returning({ id: crmRecordPresenceTable.id });
  const removedLocks = await executor
    .delete(crmRecordLocksTable)
    .where(lt(crmRecordLocksTable.leaseExpiresAt, lockCutoff))
    .returning({ id: crmRecordLocksTable.id });
  return { presenceRemoved: removedPresence.length, locksRemoved: removedLocks.length };
}

function mapLockRow(row: Record<string, unknown>): RecordLock {
  return {
    id: String(row.id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    staffId: String(row.staff_id),
    intent: String(row.intent),
    leaseExpiresAt: new Date(String(row.lease_expires_at)),
    lockGeneration: Number(row.lock_generation),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}
