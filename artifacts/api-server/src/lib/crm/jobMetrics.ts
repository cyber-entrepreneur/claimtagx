import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const ALLOWED_STATUS = new Set(["pending", "running", "dead", "completed", "failed"]);

export type JobQueueSnapshot = {
  createdByType: Record<string, number>;
  pendingByType: Record<string, number>;
  runningByType: Record<string, number>;
  deadByType: Record<string, number>;
  oldestPendingAgeMs: number;
  workerConcurrency: number;
  workerSaturation: number;
  leaseReclaims: number;
  staleWorkerRejections: number;
};

function boundedType(type: string): string {
  const t = type.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  return t || "unknown";
}

/** Queue gauges keyed only by job type (bounded cardinality). */
export async function collectJobQueueSnapshot(params: {
  workerConcurrency: number;
  slotsBusy: number;
  leaseReclaims: number;
  staleWorkerRejections: number;
}): Promise<JobQueueSnapshot> {
  const result = await db.execute(sql`
    SELECT type, status, count(*)::int AS n,
           CASE WHEN status = 'pending'
             THEN extract(epoch from (now() - min(created_at))) * 1000
             ELSE 0 END AS oldest_ms
    FROM crm_jobs
    GROUP BY type, status
  `);
  const list = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{
    type: string;
    status: string;
    n: number;
    oldest_ms: number;
  }>;

  const createdByType: Record<string, number> = {};
  const pendingByType: Record<string, number> = {};
  const runningByType: Record<string, number> = {};
  const deadByType: Record<string, number> = {};
  let oldestPendingAgeMs = 0;

  for (const row of list) {
    const type = boundedType(String(row.type));
    const status = String(row.status);
    const n = Number(row.n) || 0;
    createdByType[type] = (createdByType[type] ?? 0) + n;
    if (!ALLOWED_STATUS.has(status)) continue;
    if (status === "pending") {
      pendingByType[type] = n;
      oldestPendingAgeMs = Math.max(oldestPendingAgeMs, Number(row.oldest_ms) || 0);
    } else if (status === "running") runningByType[type] = n;
    else if (status === "dead") deadByType[type] = n;
  }

  return {
    createdByType,
    pendingByType,
    runningByType,
    deadByType,
    oldestPendingAgeMs,
    workerConcurrency: params.workerConcurrency,
    workerSaturation:
      params.workerConcurrency > 0 ? params.slotsBusy / params.workerConcurrency : 0,
    leaseReclaims: params.leaseReclaims,
    staleWorkerRejections: params.staleWorkerRejections,
  };
}

export function snapshotMetricLabels(snapshot: JobQueueSnapshot): string[] {
  return [
    ...Object.keys(snapshot.createdByType),
    ...Object.keys(snapshot.pendingByType),
    ...Object.keys(snapshot.runningByType),
    ...Object.keys(snapshot.deadByType),
  ];
}
