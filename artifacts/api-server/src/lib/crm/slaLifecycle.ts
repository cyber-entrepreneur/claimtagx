import { db, crmSlaInstancesTable, crmSlaPoliciesTable, type DbSession } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { addBusinessMinutes, calendarFromPolicy, evaluateClock, remainingMsAtPause } from "./slaCalendar";

export const OPEN_SLA = ["OPEN", "ON_TRACK", "AT_RISK", "BREACHED"] as const;
export const AT_RISK_MS = 60 * 60_000;

export type SlaClockStatus = "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED" | "PAUSED";

export { evaluateClock };

export async function completeSlaMeasure(inquiryId: string, measure: string, at = new Date()): Promise<number> {
  const updated = await db
    .update(crmSlaInstancesTable)
    .set({ status: "COMPLETED", completedAt: at, pausedAt: null })
    .where(
      and(
        eq(crmSlaInstancesTable.inquiryId, inquiryId),
        eq(crmSlaInstancesTable.measure, measure),
        inArray(crmSlaInstancesTable.status, [...OPEN_SLA, "PAUSED"]),
      ),
    )
    .returning({ id: crmSlaInstancesTable.id });
  return updated.length;
}

export async function pauseInquirySla(inquiryId: string, at = new Date()): Promise<number> {
  const rows = await db
    .select()
    .from(crmSlaInstancesTable)
    .where(
      and(eq(crmSlaInstancesTable.inquiryId, inquiryId), inArray(crmSlaInstancesTable.status, [...OPEN_SLA])),
    );
  for (const row of rows) {
    const remaining = remainingMsAtPause(row.dueAt, at);
    await db
      .update(crmSlaInstancesTable)
      .set({ status: "PAUSED", pausedAt: at, remainingMs: remaining })
      .where(eq(crmSlaInstancesTable.id, row.id));
  }
  return rows.length;
}

export async function resumeInquirySla(inquiryId: string, at = new Date()): Promise<number> {
  const paused = await db
    .select()
    .from(crmSlaInstancesTable)
    .where(
      and(eq(crmSlaInstancesTable.inquiryId, inquiryId), eq(crmSlaInstancesTable.status, "PAUSED")),
    );
  const ctx = await policyForInquiry(inquiryId);
  const cal = calendarFromPolicy(ctx?.policy ?? {});
  for (const row of paused) {
    const remainingMin = Math.max(1, Math.ceil((row.remainingMs ?? 0) / 60_000));
    await db
      .update(crmSlaInstancesTable)
      .set({
        status: "ON_TRACK",
        dueAt: addBusinessMinutes(at, remainingMin, cal),
        pausedAt: null,
        remainingMs: null,
      })
      .where(eq(crmSlaInstancesTable.id, row.id));
  }
  return paused.length;
}

export async function pauseOpenNextResponse(inquiryId: string, at = new Date()): Promise<void> {
  const rows = await db
    .select()
    .from(crmSlaInstancesTable)
    .where(
      and(
        eq(crmSlaInstancesTable.inquiryId, inquiryId),
        eq(crmSlaInstancesTable.measure, "next_response"),
        inArray(crmSlaInstancesTable.status, [...OPEN_SLA]),
      ),
    );
  for (const row of rows) {
    await db
      .update(crmSlaInstancesTable)
      .set({ status: "PAUSED", pausedAt: at, remainingMs: remainingMsAtPause(row.dueAt, at) })
      .where(eq(crmSlaInstancesTable.id, row.id));
  }
}

async function policyForInquiry(inquiryId: string, executor: DbSession = db) {
  const [row] = await executor
    .select()
    .from(crmSlaInstancesTable)
    .where(eq(crmSlaInstancesTable.inquiryId, inquiryId))
    .limit(1);
  if (!row) return null;
  const [policy] = await executor
    .select()
    .from(crmSlaPoliciesTable)
    .where(eq(crmSlaPoliciesTable.id, row.policyId))
    .limit(1);
  return policy ? { policy, policyVersion: row.policyVersion } : null;
}

export async function rearmNextResponseSla(inquiryId: string, at = new Date(), executor: DbSession = db): Promise<void> {
  const paused = await executor
    .select()
    .from(crmSlaInstancesTable)
    .where(
      and(
        eq(crmSlaInstancesTable.inquiryId, inquiryId),
        eq(crmSlaInstancesTable.measure, "next_response"),
        eq(crmSlaInstancesTable.status, "PAUSED"),
      ),
    );
  if (paused.length) {
    const ctx = await policyForInquiry(inquiryId, executor);
    const cal = calendarFromPolicy(ctx?.policy ?? {});
    for (const row of paused) {
      const remainingMin = Math.max(1, Math.ceil((row.remainingMs ?? 0) / 60_000));
      await executor
        .update(crmSlaInstancesTable)
        .set({
          status: "ON_TRACK",
          dueAt: addBusinessMinutes(at, remainingMin, cal),
          pausedAt: null,
          remainingMs: null,
        })
        .where(eq(crmSlaInstancesTable.id, row.id));
    }
    return;
  }

  const open = await executor
    .select({ id: crmSlaInstancesTable.id })
    .from(crmSlaInstancesTable)
    .where(
      and(
        eq(crmSlaInstancesTable.inquiryId, inquiryId),
        eq(crmSlaInstancesTable.measure, "next_response"),
        inArray(crmSlaInstancesTable.status, [...OPEN_SLA]),
      ),
    )
    .limit(1);
  if (open.length) return;

  const ctx = await policyForInquiry(inquiryId, executor);
  if (!ctx?.policy.nextResponseMinutes) return;
  await executor.insert(crmSlaInstancesTable).values({
    inquiryId,
    policyId: ctx.policy.id,
    policyVersion: ctx.policyVersion,
    measure: "next_response",
    dueAt: addBusinessMinutes(at, ctx.policy.nextResponseMinutes, calendarFromPolicy(ctx.policy)),
    status: "ON_TRACK",
  });
}

export async function onStaffCustomerReply(
  inquiryId: string,
  firstResponseAt: Date | null,
  at = new Date(),
): Promise<void> {
  if (!firstResponseAt) {
    await completeSlaMeasure(inquiryId, "first_response", at);
  }
  await completeSlaMeasure(inquiryId, "next_response", at);
}

export async function onCustomerReply(inquiryId: string, at = new Date(), executor: DbSession = db): Promise<void> {
  await rearmNextResponseSla(inquiryId, at, executor);
}
