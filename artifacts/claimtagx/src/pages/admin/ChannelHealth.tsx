import { Radio } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ApiError,
  getPlatformMe,
  listPlatformContactChannels,
  refreshPlatformContactChannelsHealth,
} from "@workspace/api-client-react";

type ChannelRow = {
  channel: string;
  account: string;
  status: string;
  live: boolean;
  simulator: boolean;
  enabled: boolean;
  capabilities: {
    inbound?: boolean;
    outbound?: boolean;
    webhooks?: boolean;
    polling?: boolean;
    manualHandoff?: boolean;
  };
  missingRequirements: string[];
  credentialConfigured: boolean;
  credentialRef: string | null;
  subscriptionStatus: string | null;
  subscriptionExpiresAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastHealthCheckAt: string | null;
  lastError: string | null;
  liveVerifiedAt: string | null;
  testStatus: string;
};

function restrictionLabel(status: string): string {
  if (status === "BLOCKED_APP_REVIEW") return "App review required";
  if (status === "PARTNER_GATED") return "Partner program required";
  if (status === "UNSUPPORTED_BY_PUBLIC_API") return "No public API";
  if (status === "DISABLED") return "Disabled";
  if (status === "ERROR") return "Error";
  return "—";
}

export default function ChannelHealth() {
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [quarantineOpenCount, setQuarantineOpenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    return listPlatformContactChannels().then((data) => {
      const payload = data as { channels?: ChannelRow[]; quarantineOpenCount?: number };
      setRows(payload.channels ?? []);
      setQuarantineOpenCount(payload.quarantineOpenCount ?? 0);
    });
  }

  useEffect(() => {
    getPlatformMe()
      .then((me) => {
        const perms: string[] = Array.isArray(me.permissions) ? [...me.permissions] : [];
        setCanManage(perms.includes("channels.manage") || perms.includes("*"));
      })
      .catch(() => setCanManage(false));
    load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load channels"));
  }, []);

  return (
    <div className="p-4 md:p-6" data-testid="channel-health">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Radio className="w-5 h-5" /> Channel health
          </h1>
          <p className="text-sm text-ink mt-1">
            Official provider adapters only. A simulator is never labeled live.
          </p>
          <p className="text-xs text-ink mt-1" data-testid="channel-quarantine-count">
            Open quarantined inbound events: {quarantineOpenCount}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            data-testid="channel-health-refresh"
            className="text-sm border border-white/20 px-3 py-1.5 rounded disabled:opacity-40"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              setError(null);
              try {
                await refreshPlatformContactChannelsHealth();
                await load();
              } catch (err) {
                if (err instanceof ApiError && err.status === 403) {
                  setError("Channel refresh requires channels.manage");
                } else {
                  setError(err instanceof Error ? err.message : "Health refresh failed");
                }
              } finally {
                setRefreshing(false);
              }
            }}
          >
            Refresh health
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-red-400 text-sm mt-3">{error}</p> : null}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <caption className="sr-only">Connected communication channels and their honest status</caption>
          <thead>
            <tr className="text-ink text-xs uppercase tracking-wide border-b border-white/10">
              <th scope="col" className="py-2 pr-3">Channel</th>
              <th scope="col" className="py-2 pr-3">Account</th>
              <th scope="col" className="py-2 pr-3">Configured</th>
              <th scope="col" className="py-2 pr-3">Status</th>
              <th scope="col" className="py-2 pr-3">Inbound / outbound</th>
              <th scope="col" className="py-2 pr-3">Missing</th>
              <th scope="col" className="py-2 pr-3">Last inbound</th>
              <th scope="col" className="py-2 pr-3">Last outbound</th>
              <th scope="col" className="py-2 pr-3">Last health check</th>
              <th scope="col" className="py-2 pr-3">Last error</th>
              <th scope="col" className="py-2 pr-3">Live verified at</th>
              <th scope="col" className="py-2">Restrictions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.channel} className="border-b border-white/5 align-top" data-testid={`channel-row-${row.channel}`}>
                <td className="py-3 pr-3 font-medium">{row.channel}</td>
                <td className="py-3 pr-3">{row.account}</td>
                <td className="py-3 pr-3">{row.credentialConfigured ? "Configured" : "Not configured"}</td>
                <td className="py-3 pr-3 font-mono text-xs" data-testid={`channel-status-${row.channel}`}>{row.status}</td>
                <td className="py-3 pr-3 text-xs">
                  {row.capabilities.inbound ? "inbound" : "no inbound"}
                  {" / "}
                  {row.capabilities.outbound ? "outbound" : "no outbound"}
                </td>
                <td className="py-3 pr-3 text-xs text-ink">{row.missingRequirements.join("; ") || "—"}</td>
                <td className="py-3 pr-3">{row.lastInboundAt ? new Date(row.lastInboundAt).toLocaleString() : "—"}</td>
                <td className="py-3 pr-3">{row.lastOutboundAt ? new Date(row.lastOutboundAt).toLocaleString() : "—"}</td>
                <td className="py-3 pr-3">{row.lastHealthCheckAt ? new Date(row.lastHealthCheckAt).toLocaleString() : "—"}</td>
                <td className="py-3 pr-3 text-xs">{row.lastError ?? "—"}</td>
                <td className="py-3 pr-3 text-xs">{row.liveVerifiedAt ? new Date(row.liveVerifiedAt).toLocaleString() : "—"}</td>
                <td className="py-3 text-xs">{restrictionLabel(row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
