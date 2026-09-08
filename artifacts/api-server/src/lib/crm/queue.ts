import { db, pool, crmJobsTable, crmJobEffectsTable, type DbSession, type JsonMap } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../logger";
import { createWorkerId } from "./workerIdentity";
import { classifyJobFailure, jobConcurrencyKey, recordJobPipelineEvent } from "./jobPipeline";

export { createWorkerId } from "./workerIdentity";

export type { DbSession };

const backoffMs = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function jobLeaseMs(): number {
  const n = Number(process.env.CRM_JOB_LEASE_MS ?? 5 * 60_000);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60_000;
}

export function jobHeartbeatMs(): number {
  const lease = jobLeaseMs();
  const configured = Number(process.env.CRM_JOB_HEARTBEAT_MS ?? Math.max(25, Math.floor(lease / 3)));
  const n = Number.isFinite(configured) && configured > 0 ? configured : Math.max(25, Math.floor(lease / 3));
  return Math.min(n, Math.max(20, Math.floor(lease / 2)));
}

export function retryBackoffMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts - 1, 0), backoffMs.length - 1);
  return backoffMs[idx];
}

export const queueMetrics = {
  claimed: 0,
  completed: 0,
  failed: 0,
  deadLettered: 0,
  leaseLost: 0,
  unknownType: 0,
  heartbeatsRenewed: 0,
  heartbeatFailures: 0,
  releasedOnShutdown: 0,
  shutdownForced: 0,
  handlerDurationMs: 0,
  activeRenewals: 0,
  maxConcurrentRenewals: 0,
  heartbeatTimeouts: 0,
  leaseReclaims: 0,
  duplicateClaims: 0,
  retriesByClass: {} as Record<string, number>,
};

export class LostOwnershipError extends Error {
  constructor(jobId: string) {
    super(`lost job ownership: ${jobId}`);
    this.name = "LostOwnershipError";
  }
}

export type JobRunContext = {
  jobId: string;
  workerId: string;
  claimGeneration: number;
  attempts?: number;
  signal: AbortSignal;
};

export const activeHandlerAborts = new Set<AbortController>();

export type ClaimedJob = typeof crmJobsTable.$inferSelect;

function mapClaimRow(row: Record<string, unknown>): ClaimedJob {
  return {
    id: String(row.id),
    type: String(row.type),
    payload: (row.payload ?? {}) as JsonMap,
    status: String(row.status),
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 8),
    runAt: new Date(String(row.run_at)),
    lastError: row.last_error == null ? null : String(row.last_error),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
    causationId: row.causation_id == null ? null : String(row.causation_id),
    lockedAt: row.locked_at ? new Date(String(row.locked_at)) : null,
    lockedBy: row.locked_by == null ? null : String(row.locked_by),
    leaseExpiresAt: row.lease_expires_at ? new Date(String(row.lease_expires_at)) : null,
    claimGeneration: Number(row.claim_generation ?? 0),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    createdAt: new Date(String(row.created_at)),
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : null,
  };
}

export async function enqueueJob(
  type: string,
  payload: Record<string, unknown>,
  opts?: {
    correlationId?: string;
    causationId?: string;
    runAt?: Date;
    executor?: DbSession;
    idempotencyKey?: string;
  },
): Promise<void> {
  const executor = opts?.executor ?? db;
  const ck = jobConcurrencyKey({ type, payload });
  const e2eRunId = process.env.CRM_E2E_RUN_ID?.trim();
  const stored = {
    ...(ck ? { ...payload, _ck: ck } : payload),
    ...(e2eRunId ? { e2eRunId } : {}),
  };
  try {
    await executor.insert(crmJobsTable).values({
      type,
      payload: stored as JsonMap,
      correlationId: opts?.correlationId ?? null,
      causationId: opts?.causationId ?? null,
      runAt: opts?.runAt ?? new Date(),
      idempotencyKey: opts?.idempotencyKey ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts?.idempotencyKey && /idempotency|duplicate|unique/i.test(msg)) {
      logger.info({ type, idempotencyKey: opts.idempotencyKey }, "job enqueue idempotent hit");
      return;
    }
    throw err;
  }
}

export async function claimJobs(
  limit: number,
  workerId: string,
  executor: DbSession = db,
): Promise<ClaimedJob[]> {
  const leaseMs = jobLeaseMs();
  const e2eRunId = process.env.CRM_E2E_RUN_ID?.trim() || null;
  const result = await executor.execute(sql`
    UPDATE crm_jobs AS j
    SET
      status = 'running',
      attempts = CASE WHEN s.prev_status = 'pending' THEN s.prev_attempts + 1 ELSE s.prev_attempts END,
      locked_at = NOW(),
      locked_by = ${workerId},
      lease_expires_at = NOW() + (${leaseMs}::bigint * interval '1 millisecond'),
      claim_generation = j.claim_generation + 1
    FROM (
      SELECT id, status AS prev_status, attempts AS prev_attempts
      FROM crm_jobs
      WHERE
        type NOT LIKE 'dual_proc_verify%'
        AND (${e2eRunId}::text IS NULL OR payload->>'e2eRunId' = ${e2eRunId})
        AND (
          (
            status = 'pending'
            AND run_at <= NOW()
            AND (
              COALESCE(payload->>'_ck', '') = ''
              OR NOT EXISTS (
                SELECT 1 FROM crm_jobs k
                WHERE k.id <> crm_jobs.id
                  AND COALESCE(k.payload->>'_ck', '') = COALESCE(crm_jobs.payload->>'_ck', '')
                  AND (
                    k.status = 'running'
                    OR (
                      k.status = 'pending'
                      AND k.run_at <= NOW()
                      AND (k.created_at, k.id) < (crm_jobs.created_at, crm_jobs.id)
                    )
                  )
              )
            )
          )
          OR (
            status = 'running'
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < NOW()
          )
        )
      ORDER BY
        CASE WHEN type IN (
          'refresh_sla',
          'enforce_retention',
          'graph_mail_subscription_renewal',
          'graph_mail_delta_sync',
          'marketing_publish_due'
        ) THEN 1 ELSE 0 END,
        run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    ) AS s
    WHERE j.id = s.id
    RETURNING j.*, s.prev_status, s.prev_attempts
  `);
  const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  queueMetrics.claimed += rows.length;
  return rows.map((row) => {
    const job = mapClaimRow(row);
    const prevStatus = row.prev_status == null ? undefined : String(row.prev_status);
    const soakRunId = typeof job.payload.soakRunId === "string" ? job.payload.soakRunId : undefined;
    if (prevStatus === "running") {
      queueMetrics.leaseReclaims += 1;
      queueMetrics.duplicateClaims += 1;
      recordJobPipelineEvent({
        ts: Date.now(),
        event: "lease_reclaim",
        jobId: job.id,
        type: job.type,
        workerId,
        claimGeneration: job.claimGeneration,
        attempts: job.attempts,
        prevStatus,
        retryClass: "expected_lease_recovery",
        expected: true,
        soakRunId,
        correlationId: job.correlationId,
      });
      recordJobPipelineEvent({
        ts: Date.now(),
        event: "duplicate_claim",
        jobId: job.id,
        type: job.type,
        workerId,
        claimGeneration: job.claimGeneration,
        attempts: job.attempts,
        prevStatus,
        soakRunId,
        correlationId: job.correlationId,
      });
    }
    recordJobPipelineEvent({
      ts: Date.now(),
      event: "claimed",
      jobId: job.id,
      type: job.type,
      workerId,
      claimGeneration: job.claimGeneration,
      attempts: job.attempts,
      prevStatus,
      leaseMs,
      soakRunId,
      correlationId: job.correlationId,
    });
    return job;
  });
}

export async function heartbeatJob(params: {
  jobId: string;
  workerId: string;
  claimGeneration: number;
  executor?: DbSession;
  queryTimeoutMs?: number;
}): Promise<boolean> {
  if (params.executor && params.executor !== db) {
    const result = await params.executor
      .update(crmJobsTable)
      .set({
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + jobLeaseMs()),
      })
      .where(
        and(
          eq(crmJobsTable.id, params.jobId),
          eq(crmJobsTable.status, "running"),
          eq(crmJobsTable.lockedBy, params.workerId),
          eq(crmJobsTable.claimGeneration, params.claimGeneration),
        ),
      )
      .returning({ id: crmJobsTable.id });
    return result.length > 0;
  }
  return heartbeatJobOnDedicatedConnection({
    jobId: params.jobId,
    workerId: params.workerId,
    claimGeneration: params.claimGeneration,
    queryTimeoutMs: params.queryTimeoutMs,
  });
}

/** Database-enforced statement_timeout so a timed-out UPDATE cannot later extend the lease. */
export async function heartbeatJobOnDedicatedConnection(params: {
  jobId: string;
  workerId: string;
  claimGeneration: number;
  queryTimeoutMs?: number;
}): Promise<boolean> {
  const timeoutMs = params.queryTimeoutMs ?? heartbeatQueryTimeoutMs();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [`${timeoutMs}`]);
    const res = await client.query(
      `UPDATE crm_jobs
       SET locked_at = NOW(),
           lease_expires_at = NOW() + ($1::bigint * interval '1 millisecond')
       WHERE id = $2::uuid
         AND status = 'running'
         AND locked_by = $3
         AND claim_generation = $4
       RETURNING id`,
      [jobLeaseMs(), params.jobId, params.workerId, params.claimGeneration],
    );
    await client.query("COMMIT");
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function runCancellableStatement(params: {
  timeoutMs: number;
  text: string;
  values?: unknown[];
}): Promise<{ cancelled: boolean; rowCount: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [`${params.timeoutMs}`]);
    const res = await client.query(params.text, params.values ?? []);
    await client.query("COMMIT");
    return { cancelled: false, rowCount: res.rowCount ?? 0 };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "57014" || /statement timeout|canceling statement/i.test(msg)) {
      return { cancelled: true, rowCount: 0 };
    }
    throw err;
  } finally {
    client.release();
  }
}

export function heartbeatQueryTimeoutMs(): number {
  const n = Number(process.env.CRM_HEARTBEAT_QUERY_TIMEOUT_MS ?? 2_000);
  return Number.isFinite(n) && n > 0 ? n : 2_000;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function stillOwnsJob(params: {
  jobId: string;
  workerId: string;
  claimGeneration: number;
  executor?: DbSession;
}): Promise<boolean> {
  const executor = params.executor ?? db;
  const [row] = await executor
    .select({ id: crmJobsTable.id })
    .from(crmJobsTable)
    .where(
      and(
        eq(crmJobsTable.id, params.jobId),
        eq(crmJobsTable.status, "running"),
        eq(crmJobsTable.lockedBy, params.workerId),
        eq(crmJobsTable.claimGeneration, params.claimGeneration),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function assertJobOwned(ctx: JobRunContext): Promise<void> {
  if (ctx.signal.aborted) throw new LostOwnershipError(ctx.jobId);
  const owned = await stillOwnsJob(ctx);
  if (!owned) {
    queueMetrics.leaseLost += 1;
    throw new LostOwnershipError(ctx.jobId);
  }
}

export async function delayIfTestJob(ctx: JobRunContext): Promise<void> {
  if (process.env.CRM_ALLOW_TEST_JOBS !== "true") return;
  const ms = Number(process.env.CRM_TEST_SIDE_EFFECT_DELAY_MS ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LostOwnershipError(ctx.jobId));
    };
    if (ctx.signal.aborted) {
      onAbort();
      return;
    }
    ctx.signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** @deprecated Inserting committed rows is forbidden. Use applyTransactionalDbEffect. */
export async function claimJobEffect(_params: {
  key: string;
  kind: string;
  jobId?: string;
  executor?: DbSession;
}): Promise<boolean> {
  throw new Error("claimJobEffect must not mark effects committed before work; use applyTransactionalDbEffect");
}

export async function withJobHeartbeat<T>(
  params: {
    jobId: string;
    workerId: string;
    claimGeneration: number;
    intervalMs?: number;
    queryTimeoutMs?: number;
    renew?: () => Promise<boolean>;
  },
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abort = new AbortController();
  activeHandlerAborts.add(abort);
  let stopped = false;
  const intervalMs = params.intervalMs ?? jobHeartbeatMs();
  const lease = jobLeaseMs();
  if (intervalMs >= lease) {
    logger.error({ intervalMs, lease }, "heartbeat interval is not safely below lease duration");
  }
  const timeoutMs = params.queryTimeoutMs ?? heartbeatQueryTimeoutMs();
  const renewOnce = params.renew ?? (() =>
    heartbeatJob({
      jobId: params.jobId,
      workerId: params.workerId,
      claimGeneration: params.claimGeneration,
      queryTimeoutMs: timeoutMs,
    }));

  const runRenew = async (): Promise<void> => {
    if (stopped) return;
    queueMetrics.activeRenewals += 1;
    queueMetrics.maxConcurrentRenewals = Math.max(queueMetrics.maxConcurrentRenewals, queueMetrics.activeRenewals);
    try {
      const ok = params.renew
        ? await new Promise<boolean>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("heartbeat query timeout")), timeoutMs);
            renewOnce().then(
              (value) => {
                clearTimeout(timer);
                resolve(value);
              },
              (err) => {
                clearTimeout(timer);
                reject(err);
              },
            );
          })
        : await renewOnce();
      if (!ok) {
        queueMetrics.heartbeatFailures += 1;
        queueMetrics.leaseLost += 1;
        logger.warn({ jobId: params.jobId, workerId: params.workerId }, "heartbeat lost job ownership");
        abort.abort();
        return;
      }
      queueMetrics.heartbeatsRenewed += 1;
      logger.info({ jobId: params.jobId, workerId: params.workerId }, "job lease renewed");
    } catch (err) {
      queueMetrics.heartbeatFailures += 1;
      const msg = err instanceof Error ? err.message : String(err);
      const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "57014" || /timeout|canceling statement/i.test(msg)) queueMetrics.heartbeatTimeouts += 1;
      logger.error({ err, jobId: params.jobId }, "heartbeat database failure");
      abort.abort();
    } finally {
      queueMetrics.activeRenewals = Math.max(0, queueMetrics.activeRenewals - 1);
    }
  };

  const loop = (async () => {
    while (!stopped && !abort.signal.aborted) {
      const started = performance.now();
      await runRenew();
      if (stopped || abort.signal.aborted) break;
      const elapsed = performance.now() - started;
      const wait = Math.max(5, intervalMs - elapsed);
      const until = Date.now() + wait;
      while (!stopped && !abort.signal.aborted && Date.now() < until) {
        await sleep(Math.min(25, until - Date.now()), abort.signal);
      }
    }
  })();

  const started = Date.now();
  try {
    const result = await work(abort.signal);
    if (abort.signal.aborted) throw new LostOwnershipError(params.jobId);
    return result;
  } finally {
    stopped = true;
    activeHandlerAborts.delete(abort);
    await Promise.race([loop, sleep(timeoutMs + 50, new AbortController().signal)]).catch(() => undefined);
    queueMetrics.handlerDurationMs += Date.now() - started;
  }
}

export async function completeJob(params: {
  jobId: string;
  workerId: string;
  claimGeneration: number;
  executor?: DbSession;
}): Promise<boolean> {
  const executor = params.executor ?? db;
  const result = await executor
    .update(crmJobsTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(crmJobsTable.id, params.jobId),
        eq(crmJobsTable.status, "running"),
        eq(crmJobsTable.lockedBy, params.workerId),
        eq(crmJobsTable.claimGeneration, params.claimGeneration),
      ),
    )
    .returning({ id: crmJobsTable.id });
  if (result.length === 0) {
    queueMetrics.leaseLost += 1;
    logger.warn({ jobId: params.jobId, workerId: params.workerId }, "lost job ownership on complete");
    return false;
  }
  queueMetrics.completed += 1;
  return true;
}

export async function failJob(params: {
  jobId: string;
  workerId: string;
  claimGeneration: number;
  attempts: number;
  maxAttempts: number;
  error: string;
  type?: string;
  executor?: DbSession;
  immediateDead?: boolean;
}): Promise<"retry" | "dead" | "lost"> {
  const executor = params.executor ?? db;
  const classified = classifyJobFailure(params.error, params.type ?? "");
  const giveUp = params.immediateDead || classified.immediateDead || params.attempts >= params.maxAttempts;
  const injectedDelay = Number(process.env.CRM_INJECTED_RETRY_DELAY_MS ?? 250);
  const delay = giveUp
    ? 0
    : classified.retryClass === "deliberately_injected"
      ? Number.isFinite(injectedDelay) && injectedDelay >= 0
        ? injectedDelay
        : 250
      : retryBackoffMs(params.attempts);
  const result = await executor
    .update(crmJobsTable)
    .set({
      status: giveUp ? "dead" : "pending",
      lastError: `[${classified.retryClass}] ${params.error}`.slice(0, 2000),
      runAt: new Date(Date.now() + delay),
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(crmJobsTable.id, params.jobId),
        eq(crmJobsTable.status, "running"),
        eq(crmJobsTable.lockedBy, params.workerId),
        eq(crmJobsTable.claimGeneration, params.claimGeneration),
      ),
    )
    .returning({ id: crmJobsTable.id, status: crmJobsTable.status });
  if (result.length === 0) {
    queueMetrics.leaseLost += 1;
    logger.warn({ jobId: params.jobId, workerId: params.workerId }, "lost job ownership on fail");
    recordJobPipelineEvent({
      ts: Date.now(),
      event: "lost_ownership",
      jobId: params.jobId,
      type: params.type ?? "unknown",
      workerId: params.workerId,
      claimGeneration: params.claimGeneration,
      attempts: params.attempts,
      retryClass: "contention",
      expected: false,
      error: params.error,
    });
    return "lost";
  }
  queueMetrics.retriesByClass[classified.retryClass] = (queueMetrics.retriesByClass[classified.retryClass] ?? 0) + 1;
  recordJobPipelineEvent({
    ts: Date.now(),
    event: giveUp ? "dead" : "retry",
    jobId: params.jobId,
    type: params.type ?? "unknown",
    workerId: params.workerId,
    claimGeneration: params.claimGeneration,
    attempts: params.attempts,
    error: params.error,
    retryClass: classified.retryClass,
    retryDelayMs: delay,
    expected: classified.expected,
  });
  if (giveUp) {
    queueMetrics.deadLettered += 1;
    return "dead";
  }
  queueMetrics.failed += 1;
  return "retry";
}

export async function releaseUnstartedJobs(
  jobs: Array<{ id: string; claimGeneration: number }>,
  workerId: string,
  executor: DbSession = db,
): Promise<number> {
  let released = 0;
  for (const job of jobs) {
    const result = await executor
      .update(crmJobsTable)
      .set({
        status: "pending",
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        attempts: sql`GREATEST(${crmJobsTable.attempts} - 1, 0)`,
        runAt: new Date(),
      })
      .where(
        and(
          eq(crmJobsTable.id, job.id),
          eq(crmJobsTable.status, "running"),
          eq(crmJobsTable.lockedBy, workerId),
          eq(crmJobsTable.claimGeneration, job.claimGeneration),
        ),
      )
      .returning({ id: crmJobsTable.id });
    if (result.length > 0) released += 1;
  }
  queueMetrics.releasedOnShutdown += released;
  logger.info({ workerId, released }, "released unstarted claimed jobs on shutdown");
  return released;
}

async function scheduleRecurring(params: {
  type:
    | "refresh_sla"
    | "enforce_retention"
    | "graph_mail_subscription_renewal"
    | "graph_mail_delta_sync"
    | "marketing_publish_due";
  delaySql: ReturnType<typeof sql>;
  correlationId: string;
  executor: DbSession;
}): Promise<void> {
  const lockKey =
    params.type === "refresh_sla"
      ? 814_201
      : params.type === "enforce_retention"
        ? 814_202
        : params.type === "graph_mail_subscription_renewal"
          ? 814_203
          : params.type === "graph_mail_delta_sync"
            ? 814_204
            : 814_205;
  try {
    await params.executor.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    await params.executor.execute(sql`
      INSERT INTO crm_jobs (type, payload, status, run_at, correlation_id)
      VALUES (${params.type}, '{"scheduled":true}'::jsonb, 'pending', ${params.delaySql}, ${params.correlationId})
      ON CONFLICT (type) WHERE type IN ('refresh_sla', 'enforce_retention', 'graph_mail_subscription_renewal', 'graph_mail_delta_sync', 'marketing_publish_due') AND status IN ('pending', 'running')
      DO NOTHING
    `);
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "23505" || /duplicate|unique/i.test(msg)) {
      logger.info({ type: params.type }, "recurring schedule conflict absorbed");
      return;
    }
    throw err;
  }
}

export async function scheduleRecurringSlaRefresh(executor: DbSession = db): Promise<void> {
  const run = (tx: DbSession) =>
    scheduleRecurring({
      type: "refresh_sla",
      delaySql: sql`NOW() + interval '60 seconds'`,
      correlationId: "sla-scheduler",
      executor: tx,
    });
  if (executor === db) {
    await db.transaction((tx) => run(tx));
    return;
  }
  await run(executor);
}

export async function scheduleRecurringRetention(executor: DbSession = db): Promise<void> {
  const run = (tx: DbSession) =>
    scheduleRecurring({
      type: "enforce_retention",
      delaySql: sql`NOW() + interval '1 day'`,
      correlationId: "retention-scheduler",
      executor: tx,
    });
  if (executor === db) {
    await db.transaction((tx) => run(tx));
    return;
  }
  await run(executor);
}

export async function scheduleGraphMailMaintenance(executor: DbSession = db): Promise<void> {
  const run = (tx: DbSession) =>
    Promise.all([
      scheduleRecurring({
        type: "graph_mail_subscription_renewal",
        delaySql: sql`NOW() + interval '12 hours'`,
        correlationId: "graph-subscription-scheduler",
        executor: tx,
      }),
      scheduleRecurring({
        type: "graph_mail_delta_sync",
        delaySql: sql`NOW() + interval '15 minutes'`,
        correlationId: "graph-delta-scheduler",
        executor: tx,
      }),
    ]);
  if (executor === db) {
    await db.transaction((tx) => run(tx));
    return;
  }
  await run(executor);
}

export async function scheduleMarketingPublishDue(executor: DbSession = db): Promise<void> {
  const run = (tx: DbSession) =>
    scheduleRecurring({
      type: "marketing_publish_due",
      delaySql: sql`NOW() + interval '60 seconds'`,
      correlationId: "marketing-publish-scheduler",
      executor: tx,
    });
  if (executor === db) {
    await db.transaction((tx) => run(tx));
    return;
  }
  await run(executor);
}

export async function replayDeadLetterJob(params: {
  jobId: string;
  actorStaffId: string;
  reason: string;
  executor?: DbSession;
}): Promise<boolean> {
  if (!params.reason || params.reason.trim().length < 5) {
    throw Object.assign(new Error("Replay reason is required"), { status: 400 });
  }
  const executor = params.executor ?? db;
  const result = await executor
    .update(crmJobsTable)
    .set({
      status: "pending",
      runAt: new Date(),
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(crmJobsTable.id, params.jobId), eq(crmJobsTable.status, "dead")))
    .returning({ id: crmJobsTable.id });
  return result.length > 0;
}

export async function listDeadLetterJobs(
  opts?: { limit?: number; q?: string; type?: string },
  executor: DbSession = db,
) {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
  const rows = await executor.select().from(crmJobsTable).where(eq(crmJobsTable.status, "dead")).limit(500);
  return rows
    .filter((row) => {
      if (opts?.type && row.type !== opts.type) return false;
      if (opts?.q) {
        const q = opts.q.toLowerCase();
        return (
          row.id.includes(opts.q) ||
          row.type.toLowerCase().includes(q) ||
          (row.lastError ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    })
    .slice(0, limit);
}
