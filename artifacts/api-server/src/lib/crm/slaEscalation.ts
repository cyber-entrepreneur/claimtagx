export type EscalationAction = {
  jobType: "notify_staff";
  reason: string;
  measure: string;
};

/** Pure SLA breach escalation policy — no I/O. */
export function escalationForClock(input: {
  previousStatus: string;
  nextStatus: string;
  measure: string;
}): EscalationAction | null {
  if (input.nextStatus !== "BREACHED") return null;
  if (input.previousStatus === "BREACHED") return null;
  return {
    jobType: "notify_staff",
    reason: `sla_${input.measure}_breached`,
    measure: input.measure,
  };
}
