/**
 * Privacy-safe stage timing for Contact submit path.
 * Enabled when CRM_SUBMIT_TIMING=1 (or "true"). Logs structured stages only — no PII.
 */
export type SubmitStageTiming = {
  correlationId: string;
  totalMs: number;
  stages: Record<string, number>;
  pool?: { total: number; idle: number; waiting: number };
};

type Clock = { t0: number; last: number; stages: Record<string, number> };

const store = new Map<string, Clock>();

function enabled(): boolean {
  const v = process.env.CRM_SUBMIT_TIMING ?? "";
  return v === "1" || v.toLowerCase() === "true";
}

export function beginSubmitTiming(correlationId: string): void {
  if (!enabled()) return;
  const now = performance.now();
  store.set(correlationId, { t0: now, last: now, stages: {} });
}

export function markSubmitStage(correlationId: string, stage: string): void {
  if (!enabled()) return;
  const clock = store.get(correlationId);
  if (!clock) return;
  const now = performance.now();
  clock.stages[stage] = Math.round(now - clock.last);
  clock.last = now;
}

export function endSubmitTiming(
  correlationId: string,
  poolStats?: { totalCount: number; idleCount: number; waitingCount: number },
): SubmitStageTiming | null {
  if (!enabled()) {
    store.delete(correlationId);
    return null;
  }
  const clock = store.get(correlationId);
  store.delete(correlationId);
  if (!clock) return null;
  const result: SubmitStageTiming = {
    correlationId,
    totalMs: Math.round(performance.now() - clock.t0),
    stages: clock.stages,
  };
  if (poolStats) {
    result.pool = {
      total: poolStats.totalCount,
      idle: poolStats.idleCount,
      waiting: poolStats.waitingCount,
    };
  }
  return result;
}
