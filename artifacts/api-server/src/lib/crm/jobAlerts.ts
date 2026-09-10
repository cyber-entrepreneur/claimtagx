/** Bounded operational alert thresholds for the CRM job pipeline (local rules). */
export const JOB_ALERT_RULES = [
  { id: "crm.jobs.dead", metric: "dead_by_type", warn: 1, critical: 5, runbook: "RUNBOOK.md#G-JOBS" },
  { id: "crm.jobs.oldest_pending_ms", metric: "oldest_pending_age_ms", warn: 60_000, critical: 300_000, runbook: "RUNBOOK.md#G-JOBS" },
  { id: "crm.jobs.worker_saturation", metric: "worker_saturation", warn: 0.85, critical: 0.95, runbook: "RUNBOOK.md#G-PERF" },
  { id: "crm.jobs.claim_latency_ms", metric: "claim_latency_ms", warn: 2_000, critical: 10_000, runbook: "RUNBOOK.md#G-PERF" },
] as const;

export type AlertSeverity = "ok" | "warn" | "critical";

export function evaluateJobAlert(
  ruleId: (typeof JOB_ALERT_RULES)[number]["id"],
  value: number,
): AlertSeverity {
  const rule = JOB_ALERT_RULES.find((r) => r.id === ruleId);
  if (!rule) return "ok";
  if (value >= rule.critical) return "critical";
  if (value >= rule.warn) return "warn";
  return "ok";
}
