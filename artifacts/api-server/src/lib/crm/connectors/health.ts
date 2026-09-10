import { db, crmChannelAccountsTable, crmEmailQuarantineTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { listChannelAdapters } from "./registry";
import { snapshotConnectorMetrics } from "./metrics";
import { CHANNEL_STATUSES } from "./types";
import { composeChannelStatus } from "./util";

export async function listChannelHealth() {
  const adapters = listChannelAdapters();
  const rows = await db.select().from(crmChannelAccountsTable);
  const byChannel = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!byChannel.has(r.channel)) byChannel.set(r.channel, r);
  }
  return adapters.map((adapter) => {
    const health = adapter.healthCheck();
    const row = byChannel.get(adapter.channel);
    const caps = adapter.capabilities();
    const declared =
      row?.lastError && health.credentialConfigured && health.status !== "DISABLED"
        ? "ERROR"
        : health.status;
    const status = composeChannelStatus({
      declared,
      liveVerifiedAt: row?.liveVerifiedAt ?? null,
      credentialConfigured: health.credentialConfigured,
    });
    return {
      channel: adapter.channel,
      account: row?.displayName ?? adapter.channel,
      providerAccountId: row?.providerAccountId ?? null,
      status,
      live: status === "LIVE_VERIFIED" && Boolean(row?.liveVerifiedAt),
      simulator: false,
      enabled: row?.enabled ?? Boolean(caps.inbound || caps.outbound),
      capabilities: caps,
      missingRequirements: health.missingRequirements,
      credentialConfigured: health.credentialConfigured,
      credentialRef: row?.credentialRef ?? null,
      subscriptionStatus: row?.subscriptionStatus ?? null,
      subscriptionExpiresAt: row?.subscriptionExpiresAt?.toISOString() ?? null,
      lastInboundAt: row?.lastInboundAt?.toISOString() ?? null,
      lastOutboundAt: row?.lastOutboundAt?.toISOString() ?? null,
      lastHealthCheckAt: row?.lastHealthCheckAt?.toISOString() ?? null,
      lastError: row?.lastError ?? health.lastError ?? null,
      configurationVersion: row?.configurationVersion ?? 1,
      liveVerifiedAt: row?.liveVerifiedAt?.toISOString() ?? null,
      verificationEvidence: row?.verificationEvidence ?? {},
      testStatus: status === "LIVE_VERIFIED" ? "live_verified" : "not_live",
      reconnectSupported: Boolean(caps.webhooks || caps.polling),
    };
  });
}

export async function quarantineOpenCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(crmEmailQuarantineTable)
    .where(eq(crmEmailQuarantineTable.status, "open"));
  return Number(row?.n ?? 0);
}

export async function persistChannelHealthSnapshot(): Promise<void> {
  for (const report of await listChannelHealth()) {
    const [row] = await db
      .select()
      .from(crmChannelAccountsTable)
      .where(eq(crmChannelAccountsTable.channel, report.channel))
      .limit(1);
    if (!row) continue;
    await db
      .update(crmChannelAccountsTable)
      .set({
        connectionStatus: report.status,
        lastHealthCheckAt: new Date(),
        lastError: report.lastError,
        missingRequirements: report.missingRequirements,
        updatedAt: new Date(),
      })
      .where(eq(crmChannelAccountsTable.id, row.id));
  }
}

export function channelStatusModel() {
  return [...CHANNEL_STATUSES];
}

export function connectorObservability() {
  return snapshotConnectorMetrics();
}
