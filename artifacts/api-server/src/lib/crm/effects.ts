import { createHash, randomUUID } from "node:crypto";
import { db, crmJobEffectsTable, type DbSession, type JsonMap } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../logger";
import { LostOwnershipError, assertJobOwned, stillOwnsJob, type JobRunContext } from "./queue";

export const EFFECT_LEASE_MS = 30_000;
const MAX_EFFECT_ATTEMPTS = 8;

export type EffectStatus =
  | "pending"
  | "executing"
  | "provider_request_started"
  | "accepted"
  | "uncertain"
  | "locally_committed"
  | "committed"
  | "retryable_failed"
  | "terminal_failed"
  | "delivered"
  | "bounced"
  | "complained"
  | "suppressed";

export type EffectLease = {
  key: string;
  claimGeneration: number;
  processingToken: string;
  processingOwner: string;
  jobId: string | null;
  jobClaimGeneration: number | null;
};

export const effectMetrics = {
  claimed: 0,
  committed: 0,
  failed: 0,
  uncertain: 0,
  ownershipLost: 0,
  staleRejected: 0,
  recovered: 0,
};

export class EffectPayloadCollisionError extends Error {
  constructor(key: string) {
    super(`effect idempotency key reused with a different payload: ${key}`);
    this.name = "EffectPayloadCollisionError";
  }
}

export class EffectOwnershipError extends Error {
  constructor(key: string, action: string) {
    super(`lost effect ownership on ${action}: ${key}`);
    this.name = "EffectOwnershipError";
  }
}

export function hashEffectPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

export function emailEffectKey(params: {
  inquiryId: string;
  templateKey: string;
  intent: string;
  logicalIntentId: string;
}): string {
  return `email:${params.intent}:${params.inquiryId}:${params.templateKey}:${params.logicalIntentId}`;
}

async function lockEffect(tx: DbSession, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"crm.effect." + key}))`);
}

function ownershipClause(lease: EffectLease, statuses: string[]) {
  const parts = [
    eq(crmJobEffectsTable.idempotencyKey, lease.key),
    inArray(crmJobEffectsTable.status, statuses),
    eq(crmJobEffectsTable.processingToken, lease.processingToken),
    eq(crmJobEffectsTable.processingOwner, lease.processingOwner),
    eq(crmJobEffectsTable.claimGeneration, lease.claimGeneration),
  ];
  if (lease.jobId) {
    parts.push(eq(crmJobEffectsTable.jobId, lease.jobId));
  }
  if (lease.jobClaimGeneration != null) {
    parts.push(eq(crmJobEffectsTable.jobClaimGeneration, lease.jobClaimGeneration));
  }
  return and(...parts);
}

export async function applyTransactionalDbEffect(params: {
  key: string;
  kind: string;
  payload: unknown;
  ctx?: JobRunContext;
  correlationId?: string | null;
  work: (tx: DbSession) => Promise<void>;
}): Promise<"applied" | "skipped"> {
  if (params.ctx) await assertJobOwned(params.ctx);
  return db.transaction(async (tx) => {
    const lease = await claimEffectForWork(tx, {
      key: params.key,
      kind: params.kind,
      payload: params.payload,
      ctx: params.ctx,
      correlationId: params.correlationId,
    });
    if (!lease) return "skipped" as const;
    if (params.ctx && params.ctx.signal.aborted) throw new LostOwnershipError(params.ctx.jobId);
    if (params.ctx && !(await stillOwnsJob({ ...params.ctx, executor: tx }))) {
      throw new LostOwnershipError(params.ctx.jobId);
    }
    await params.work(tx);
    await commitEffect(tx, lease, params.ctx);
    return "applied" as const;
  });
}

export async function claimEffectForWork(
  tx: DbSession,
  params: {
    key: string;
    kind: string;
    payload: unknown;
    ctx?: JobRunContext;
    correlationId?: string | null;
    providerIdempotencyKey?: string;
  },
): Promise<EffectLease | null> {
  await lockEffect(tx, params.key);
  const payloadHash = hashEffectPayload(params.payload);
  const [existing] = await tx
    .select()
    .from(crmJobEffectsTable)
    .where(eq(crmJobEffectsTable.idempotencyKey, params.key))
    .limit(1);

  if (existing?.payloadHash && existing.payloadHash !== payloadHash) {
    throw new EffectPayloadCollisionError(params.key);
  }
  if (existing?.status === "committed" || existing?.status === "locally_committed") return null;
  if (existing?.status === "uncertain") return null;
  if (
    existing?.status === "executing" &&
    existing.leaseExpiresAt &&
    existing.leaseExpiresAt.getTime() > Date.now() &&
    existing.processingOwner &&
    existing.processingOwner !== (params.ctx?.workerId ?? "system")
  ) {
    return null;
  }
  if ((existing?.attempts ?? 0) >= MAX_EFFECT_ATTEMPTS) {
    await tx
      .update(crmJobEffectsTable)
      .set({
        status: "terminal_failed",
        lastError: "retry exhausted",
        failedAt: new Date(),
        processingToken: null,
        processingOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(crmJobEffectsTable.idempotencyKey, params.key));
    return null;
  }

  const token = randomUUID();
  const owner = params.ctx?.workerId ?? "system";
  const nextGen = (existing?.claimGeneration ?? 0) + 1;
  const lease: EffectLease = {
    key: params.key,
    claimGeneration: nextGen,
    processingToken: token,
    processingOwner: owner,
    jobId: params.ctx?.jobId ?? existing?.jobId ?? null,
    jobClaimGeneration: params.ctx?.claimGeneration ?? existing?.jobClaimGeneration ?? null,
  };

  if (!existing) {
    await tx.insert(crmJobEffectsTable).values({
      idempotencyKey: params.key,
      kind: params.kind,
      jobId: lease.jobId,
      jobClaimGeneration: lease.jobClaimGeneration,
      claimGeneration: nextGen,
      status: "executing",
      attempts: 1,
      processingToken: token,
      processingOwner: owner,
      leaseExpiresAt: new Date(Date.now() + EFFECT_LEASE_MS),
      payloadHash,
      providerIdempotencyKey: params.providerIdempotencyKey ?? null,
      correlationId: params.correlationId ?? params.ctx?.jobId ?? null,
      causationId: params.ctx?.jobId ?? null,
      startedAt: new Date(),
    });
    effectMetrics.claimed += 1;
    return lease;
  }

  const updated = await tx
    .update(crmJobEffectsTable)
    .set({
      status: "executing",
      attempts: existing.attempts + 1,
      claimGeneration: nextGen,
      processingToken: token,
      processingOwner: owner,
      leaseExpiresAt: new Date(Date.now() + EFFECT_LEASE_MS),
      jobId: lease.jobId,
      jobClaimGeneration: lease.jobClaimGeneration,
      payloadHash,
      providerIdempotencyKey: params.providerIdempotencyKey ?? existing.providerIdempotencyKey,
      startedAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(crmJobEffectsTable.idempotencyKey, params.key),
        eq(crmJobEffectsTable.claimGeneration, existing.claimGeneration),
        inArray(crmJobEffectsTable.status, ["pending", "executing", "retryable_failed", "provider_request_started"]),
      ),
    )
    .returning({ key: crmJobEffectsTable.idempotencyKey });
  if (updated.length === 0) {
    effectMetrics.staleRejected += 1;
    return null;
  }
  effectMetrics.claimed += 1;
  return lease;
}

export async function insertPendingEffect(params: {
  key: string;
  kind: string;
  payload: unknown;
  ctx?: JobRunContext;
  providerIdempotencyKey?: string;
  executor?: DbSession;
}): Promise<"created" | "exists"> {
  const executor = params.executor ?? db;
  const payloadHash = hashEffectPayload(params.payload);
  try {
    await executor.insert(crmJobEffectsTable).values({
      idempotencyKey: params.key,
      kind: params.kind,
      jobId: params.ctx?.jobId ?? null,
      jobClaimGeneration: params.ctx?.claimGeneration ?? null,
      claimGeneration: 0,
      status: "pending",
      attempts: 0,
      payloadHash,
      providerIdempotencyKey: params.providerIdempotencyKey ?? params.key,
      correlationId: params.ctx?.jobId ?? null,
      causationId: params.ctx?.jobId ?? null,
    });
    return "created";
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code: unknown }).code)
        : typeof err === "object" && err && "cause" in err && typeof (err as { cause: { code?: unknown } }).cause?.code !== "undefined"
          ? String((err as { cause: { code?: unknown } }).cause.code)
          : "";
    if (code === "23505") {
      const [row] = await executor
        .select()
        .from(crmJobEffectsTable)
        .where(eq(crmJobEffectsTable.idempotencyKey, params.key))
        .limit(1);
      if (row?.payloadHash && row.payloadHash !== payloadHash) throw new EffectPayloadCollisionError(params.key);
      return "exists";
    }
    throw err;
  }
}

export async function transitionEffect(
  tx: DbSession,
  lease: EffectLease,
  fromStatuses: string[],
  next: {
    status: EffectStatus;
    lastError?: string | null;
    providerMessageId?: string | null;
    providerRequestId?: string | null;
    meta?: JsonMap;
    committed?: boolean;
    failed?: boolean;
  },
): Promise<boolean> {
  const result = await tx
    .update(crmJobEffectsTable)
    .set({
      status: next.status,
      lastError: next.lastError === undefined ? undefined : next.lastError,
      providerMessageId: next.providerMessageId === undefined ? undefined : next.providerMessageId,
      providerRequestId: next.providerRequestId === undefined ? undefined : next.providerRequestId,
      meta: next.meta,
      committedAt: next.committed ? new Date() : undefined,
      failedAt: next.failed ? new Date() : undefined,
      processingToken: next.status === "committed" || next.status === "locally_committed" ? null : lease.processingToken,
      processingOwner: next.status === "committed" || next.status === "locally_committed" ? null : lease.processingOwner,
      leaseExpiresAt:
        next.status === "committed" || next.status === "locally_committed" || next.status === "uncertain"
          ? null
          : new Date(Date.now() + EFFECT_LEASE_MS),
      nextAttemptAt:
        next.status === "retryable_failed" ? new Date(Date.now() + 15_000) : next.status === "uncertain" ? null : undefined,
    })
    .where(ownershipClause(lease, fromStatuses))
    .returning({ key: crmJobEffectsTable.idempotencyKey });
  if (result.length === 0) {
    effectMetrics.staleRejected += 1;
    effectMetrics.ownershipLost += 1;
    logger.warn({ key: lease.key, owner: lease.processingOwner, action: next.status }, "effect CAS rejected");
    return false;
  }
  return true;
}

export async function commitEffect(
  tx: DbSession,
  lease: EffectLease,
  ctx?: JobRunContext,
  extra?: { providerMessageId?: string | null; providerRequestId?: string | null; meta?: JsonMap },
): Promise<void> {
  const ok = await transitionEffect(tx, lease, ["executing", "provider_request_started", "accepted"], {
    status: "committed",
    committed: true,
    lastError: null,
    providerMessageId: extra?.providerMessageId,
    providerRequestId: extra?.providerRequestId,
    meta: extra?.meta,
  });
  if (!ok) {
    throw ctx ? new LostOwnershipError(ctx.jobId) : new EffectOwnershipError(lease.key, "commit");
  }
  effectMetrics.committed += 1;
}

export async function failEffect(
  lease: EffectLease,
  error: string,
  opts?: { uncertain?: boolean; terminal?: boolean; executor?: DbSession },
): Promise<boolean> {
  const status: EffectStatus = opts?.uncertain ? "uncertain" : opts?.terminal ? "terminal_failed" : "retryable_failed";
  const executor = opts?.executor ?? db;
  const ok = await transitionEffect(executor, lease, ["executing", "provider_request_started", "accepted"], {
    status,
    failed: true,
    lastError: error.slice(0, 2000),
  });
  if (ok) {
    if (opts?.uncertain) effectMetrics.uncertain += 1;
    else effectMetrics.failed += 1;
  }
  return ok;
}

export async function heartbeatEffect(lease: EffectLease, executor: DbSession = db): Promise<boolean> {
  const result = await executor
    .update(crmJobEffectsTable)
    .set({ leaseExpiresAt: new Date(Date.now() + EFFECT_LEASE_MS) })
    .where(ownershipClause(lease, ["executing", "provider_request_started", "accepted"]))
    .returning({ key: crmJobEffectsTable.idempotencyKey });
  if (result.length === 0) {
    effectMetrics.staleRejected += 1;
    return false;
  }
  return true;
}

export async function loadEffect(key: string) {
  const [row] = await db.select().from(crmJobEffectsTable).where(eq(crmJobEffectsTable.idempotencyKey, key)).limit(1);
  return row ?? null;
}

export async function replayTerminalEffect(params: {
  key: string;
  actorStaffId: string;
  reason: string;
  allowUncertain?: boolean;
}): Promise<boolean> {
  if (!params.reason.trim()) throw Object.assign(new Error("Replay reason is required"), { status: 400 });
  const [row] = await db.select().from(crmJobEffectsTable).where(eq(crmJobEffectsTable.idempotencyKey, params.key)).limit(1);
  if (!row) return false;
  if (row.status === "committed" || row.status === "locally_committed") {
    throw Object.assign(new Error("Committed effects cannot be replayed"), { status: 409 });
  }
  if (row.status === "uncertain" && !params.allowUncertain) {
    throw Object.assign(new Error("Uncertain email cannot be blindly replayed; reconcile first"), { status: 409 });
  }
  const result = await db
    .update(crmJobEffectsTable)
    .set({
      status: "pending",
      nextAttemptAt: new Date(),
      lastError: `authorized replay: ${params.reason}`.slice(0, 2000),
      processingToken: null,
      processingOwner: null,
      leaseExpiresAt: null,
      failedAt: null,
    })
    .where(
      and(
        eq(crmJobEffectsTable.idempotencyKey, params.key),
        inArray(crmJobEffectsTable.status, params.allowUncertain ? ["terminal_failed", "uncertain"] : ["terminal_failed"]),
      ),
    )
    .returning({ key: crmJobEffectsTable.idempotencyKey });
  return result.length > 0;
}

export async function expireStaleEffects(): Promise<number> {
  const emailUncertain = await db
    .update(crmJobEffectsTable)
    .set({
      status: "uncertain",
      lastError: "lease expired after provider request started",
      processingToken: null,
      processingOwner: null,
      leaseExpiresAt: null,
      failedAt: new Date(),
    })
    .where(
      and(
        eq(crmJobEffectsTable.kind, "email"),
        inArray(crmJobEffectsTable.status, ["provider_request_started", "accepted"]),
        sql`${crmJobEffectsTable.leaseExpiresAt} < now()`,
      ),
    )
    .returning({ key: crmJobEffectsTable.idempotencyKey });
  effectMetrics.uncertain += emailUncertain.length;
  const rows = await db
    .update(crmJobEffectsTable)
    .set({
      status: "retryable_failed",
      lastError: "effect lease expired",
      processingToken: null,
      processingOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(),
      failedAt: new Date(),
    })
    .where(
      and(
        eq(crmJobEffectsTable.status, "executing"),
        sql`${crmJobEffectsTable.leaseExpiresAt} < now()`,
      ),
    )
    .returning({ key: crmJobEffectsTable.idempotencyKey });
  effectMetrics.recovered += rows.length;
  return rows.length + emailUncertain.length;
}

export async function reconcileUncertainEmail(key: string): Promise<"accepted" | "retryable" | "unknown"> {
  const row = await loadEffect(key);
  if (!row || row.status !== "uncertain") return "unknown";
  const { reconcileSimulatedSend } = await import("./emailSimulator");
  const { reconcileSimulatedGraphSend } = await import("./microsoftGraph/simulator");
  const { reconcileGraphSend } = await import("./microsoftGraph/client");
  const found =
    reconcileSimulatedGraphSend(row.providerIdempotencyKey ?? key) ??
    (row.providerRequestId ? reconcileSimulatedGraphSend(row.providerRequestId) : null) ??
    reconcileSimulatedSend(row.providerIdempotencyKey ?? key) ??
    (row.providerRequestId ? reconcileSimulatedSend(row.providerRequestId) : null);
  const graphLive =
    !found && row.providerRequestId
      ? await reconcileGraphSend(row.providerRequestId).catch(() => null)
      : null;
  const acceptedId = found?.providerMessageId ?? graphLive?.providerMessageId;
  const acceptedRequest = found?.providerRequestId ?? graphLive?.providerRequestId ?? row.providerRequestId;
  if (acceptedId) {
    await db
      .update(crmJobEffectsTable)
      .set({
        status: "accepted",
        providerMessageId: acceptedId,
        providerRequestId: acceptedRequest,
        lastError: null,
      })
      .where(and(eq(crmJobEffectsTable.idempotencyKey, key), eq(crmJobEffectsTable.status, "uncertain")));
    return "accepted";
  }
  if (found && found.status === "unknown") return "unknown";
  if (!found && !graphLive) {
    await db
      .update(crmJobEffectsTable)
      .set({
        status: "retryable_failed",
        nextAttemptAt: new Date(),
        lastError: "reconciliation found no provider send",
      })
      .where(and(eq(crmJobEffectsTable.idempotencyKey, key), eq(crmJobEffectsTable.status, "uncertain")));
    return "retryable";
  }
  return "unknown";
}

export async function processRecoverableEffects(): Promise<{ pending: number; expired: number; uncertain: number }> {
  const expired = await expireStaleEffects();
  const pending = await db
    .select({ key: crmJobEffectsTable.idempotencyKey })
    .from(crmJobEffectsTable)
    .where(inArray(crmJobEffectsTable.status, ["pending", "retryable_failed"]));
  const uncertain = await db
    .select({ key: crmJobEffectsTable.idempotencyKey })
    .from(crmJobEffectsTable)
    .where(eq(crmJobEffectsTable.status, "uncertain"));
  for (const row of uncertain) {
    if (process.env.CRM_EMAIL_SIMULATOR === "true" || process.env.CRM_ALLOW_TEST_JOBS === "true") {
      await reconcileUncertainEmail(row.key);
    }
  }
  return { pending: pending.length, expired, uncertain: uncertain.length };
}
