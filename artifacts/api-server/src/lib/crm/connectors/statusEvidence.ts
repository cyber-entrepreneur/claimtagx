import { db, crmChannelAccountsTable, type DbSession } from "@workspace/db";
import { eq } from "drizzle-orm";
import { firstPartyEvidenceBlocked } from "./util";

export type ChannelEvidenceClass = "fixture" | "simulator" | "first_party" | "real_provider";

function asEvidence(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export async function recordChannelActivity(
  executor: DbSession,
  accountId: string,
  kind: "inbound" | "outbound",
  error?: string | null,
  evidenceClass: ChannelEvidenceClass = "fixture",
): Promise<void> {
  const now = new Date();
  const [current] = await executor
    .select()
    .from(crmChannelAccountsTable)
    .where(eq(crmChannelAccountsTable.id, accountId))
    .limit(1);
  if (!current) return;
  const evidence = asEvidence(current.verificationEvidence);
  evidence[`${kind}Class`] = evidenceClass;
  evidence[`${kind}At`] = now.toISOString();
  const patch =
    kind === "inbound"
      ? { lastInboundAt: now, lastError: error ?? null, updatedAt: now, verificationEvidence: evidence }
      : { lastOutboundAt: now, lastError: error ?? null, updatedAt: now, verificationEvidence: evidence };
  await executor.update(crmChannelAccountsTable).set(patch).where(eq(crmChannelAccountsTable.id, accountId));
  await maybeMarkLiveVerified(executor, accountId);
}

export async function setChannelError(accountId: string, lastError: string, executor: DbSession = db): Promise<void> {
  await executor
    .update(crmChannelAccountsTable)
    .set({
      connectionStatus: "ERROR",
      lastError,
      lastHealthCheckAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(crmChannelAccountsTable.id, accountId));
}

export async function maybeMarkLiveVerified(executor: DbSession = db, accountId: string): Promise<void> {
  if (firstPartyEvidenceBlocked()) return;
  const [row] = await executor
    .select()
    .from(crmChannelAccountsTable)
    .where(eq(crmChannelAccountsTable.id, accountId))
    .limit(1);
  if (!row || row.liveVerifiedAt) return;
  if (!row.lastInboundAt || !row.lastOutboundAt) return;
  const evidence = asEvidence(row.verificationEvidence);
  if (evidence.inboundClass !== "real_provider" || evidence.outboundClass !== "real_provider") return;
  if (
    row.connectionStatus === "DISABLED" ||
    row.connectionStatus === "UNSUPPORTED_BY_PUBLIC_API" ||
    row.connectionStatus === "PARTNER_GATED"
  ) {
    return;
  }
  await executor
    .update(crmChannelAccountsTable)
    .set({
      liveVerifiedAt: new Date(),
      connectionStatus: "LIVE_VERIFIED",
      verificationEvidence: {
        ...evidence,
        kind: "classified_real_provider_round_trip",
        lastInboundAt: row.lastInboundAt.toISOString(),
        lastOutboundAt: row.lastOutboundAt.toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(crmChannelAccountsTable.id, accountId));
}
