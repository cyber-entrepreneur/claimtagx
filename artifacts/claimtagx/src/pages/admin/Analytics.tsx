import { useEffect, useState } from "react";
import { platformFetch } from "@/lib/contactApi";

export default function AdminAnalytics() {
  const [data, setData] = useState<{
    totals: { total: number; qualified: number; open: number };
    byCountry: Array<{ country: string; count: number }>;
    events: Array<{ event: string; count: number }>;
    sla: { breached: number; onTrack: number; atRisk: number };
  } | null>(null);

  useEffect(() => {
    platformFetch("/api/platform/contact/analytics").then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <div className="p-8 text-slate">Loading analytics…</div>;

  return (
    <div className="p-4 md:p-6 space-y-8">
      <h1 className="text-xl font-semibold">Contact analytics</h1>
      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Inquiries" value={data.totals.total} />
        <Stat label="Qualified" value={data.totals.qualified} />
        <Stat label="Open" value={data.totals.open} />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="SLA on track" value={data.sla.onTrack} />
        <Stat label="SLA at risk" value={data.sla.atRisk} />
        <Stat label="SLA breached" value={data.sla.breached} />
      </div>
      <section>
        <h2 className="font-medium mb-3">By country</h2>
        <ul className="text-sm space-y-1">
          {data.byCountry.map((r) => (
            <li key={r.country} className="flex justify-between max-w-sm">
              <span>{r.country}</span><span className="font-mono">{r.count}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium mb-3">Canonical events</h2>
        <ul className="text-sm space-y-1">
          {data.events.map((r) => (
            <li key={r.event} className="flex justify-between max-w-sm">
              <span>{r.event}</span><span className="font-mono">{r.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-white/10 rounded-xl p-4">
      <p className="text-xs text-slate uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-semibold mt-1">{value}</p>
    </div>
  );
}
