import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  createPlatformContactExport,
  cancelPlatformContactExport,
  getDownloadPlatformContactExportUrl,
  getPlatformContactAnalytics,
  getPlatformContactExport,
} from "@workspace/api-client-react";

type AnalyticsPayload = {
  totals: {
    total: number;
    qualified: number;
    open: number;
    sales: number;
    support: number;
  };
  byCountry: Array<{ country: string; count: number }>;
  byInquiryType: Array<{ inquiryType: string; count: number }>;
  byQualification: Array<{ status: string; count: number }>;
  events: Array<{ event: string; count: number }>;
  sla: { breached: number; onTrack: number; atRisk: number; completed: number };
  jobs: { pending: number; running: number; dead: number };
  funnel?: { created: number; qualified: number; meetingOffered: number; meetingBooked: number };
  abandonment?: { formViews: number; submits: number; abandoned: number; rate: number | null };
  definitions: Record<string, string>;
};

export default function AdminAnalytics() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [timeZone, setTimeZone] = useState("UTC");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);

  useEffect(() => {
    getPlatformContactAnalytics({
        from: from || undefined,
        to: to || undefined,
        timeZone: timeZone || undefined,
      })
      .then((payload) => setData(payload as AnalyticsPayload))
      .catch((err: Error) => setError(err.message || "Failed to load analytics"));
  }, [from, to, timeZone]);

  if (error) {
    return (
      <div className="p-8 text-red-300" role="alert" data-testid="admin-analytics-error">
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-8 text-ink" role="status" aria-live="polite" data-testid="admin-analytics-loading">
        Loading analytics…
      </div>
    );
  }

  const qualifyRate =
    data.totals.total > 0
      ? Math.round((data.totals.qualified / data.totals.total) * 1000) / 10
      : 0;

  async function startAnalyticsCsvExport() {
    setExportBusy(true);
    setExportError(null);
    setExportStatus("queued");
    setExportJobId(null);
    try {
      const created = await createPlatformContactExport({
          columns: ["reference"],
          filters: {
            kind: "analytics_snapshot",
            from: from || undefined,
            to: to || undefined,
            timeZone: timeZone || undefined,
          },
        });
      const id = created.job.id;
      setExportJobId(id);
      setExportStatus(created.job.status ?? "queued");
      for (let i = 0; i < 50; i++) {
        const { job } = await getPlatformContactExport(id);
        setExportStatus(job.status ?? "running");
        if (job.status === "completed") {
          const url = getDownloadPlatformContactExportUrl(id);
          const res = await fetch(url, { credentials: "same-origin" });
          if (!res.ok) {
            throw new Error(`Export download failed (${res.status})`);
          }
          const blob = await res.blob();
          if (blob.size < 1) {
            throw new Error("Export download was empty");
          }
          const href = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = href;
          a.download = `analytics-export-${id}.csv`;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
          return;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          throw new Error(typeof job.error === "string" ? job.error : `Export ${job.status}`);
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      throw new Error("Export timed out");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-8" data-testid="admin-analytics">
      <div>
        <h1 className="text-xl font-semibold">Contact analytics</h1>
        <p className="text-sm text-ink mt-1">
          Metrics use the selected IANA time zone for display context. Counts are filtered by created_at when a date range is set.
        </p>
        <form className="mt-4 flex flex-wrap gap-3 text-sm" onSubmit={(e) => e.preventDefault()}>
          <label>
            From
            <input type="date" className="ml-2 bg-steel border border-white/20 text-white rounded px-2 py-1" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" className="ml-2 bg-steel border border-white/20 text-white rounded px-2 py-1" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Time zone
            <input className="ml-2 bg-steel border border-white/20 text-white rounded px-2 py-1" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
          </label>
          <button
            type="button"
            className="cta-lime self-end px-3 py-1.5 rounded-lg text-sm font-semibold disabled:cursor-not-allowed"
            disabled={exportBusy}
            aria-disabled={exportBusy}
            onClick={() => void startAnalyticsCsvExport()}
            data-testid="analytics-export-csv"
          >
            {exportBusy ? "Exporting…" : "Export CSV"}
          </button>
          {exportJobId && exportBusy ? (
            <button
              type="button"
              className="cta-steel self-end px-3 py-1.5 rounded-lg text-sm font-semibold border border-white/20"
              data-testid="analytics-export-cancel"
              onClick={() => {
                void cancelPlatformContactExport(exportJobId).then(() => {
                  setExportStatus("cancelled");
                  setExportBusy(false);
                });
              }}
            >
              Cancel export
            </button>
          ) : null}
        </form>
        {exportStatus ? (
          <p className="text-sm text-ink mt-2" data-testid="analytics-export-status" aria-live="polite">
            Export status: {exportStatus}
          </p>
        ) : null}
        {exportError ? (
          <p className="text-sm text-red-300 mt-2" role="alert" data-testid="analytics-export-error">
            {exportError}
          </p>
        ) : null}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Inquiries" value={data.totals.total} />
        <Stat label="Qualified" value={data.totals.qualified} hint={`${qualifyRate}% of total`} />
        <Stat label="Open" value={data.totals.open} />
        <Stat label="Sales / Support" value={`${data.totals.sales} / ${data.totals.support}`} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="SLA on track" value={data.sla.onTrack} />
        <Stat label="SLA at risk" value={data.sla.atRisk} />
        <Stat label="SLA breached" value={data.sla.breached} />
        <Stat label="SLA completed" value={data.sla.completed} />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Jobs pending" value={data.jobs.pending} />
        <Stat label="Jobs running" value={data.jobs.running} />
        <Stat label="Jobs dead-letter" value={data.jobs.dead} />
      </div>

      {data.funnel ? (
        <div className="grid sm:grid-cols-4 gap-4">
          <Stat label="Funnel: created" value={data.funnel.created} />
          <Stat label="Funnel: qualified" value={data.funnel.qualified} />
          <Stat label="Meetings offered" value={data.funnel.meetingOffered} />
          <Stat label="Meetings booked" value={data.funnel.meetingBooked} />
        </div>
      ) : null}

      {data.abandonment ? (
        <div className="grid sm:grid-cols-4 gap-4">
          <Stat label="Form views" value={data.abandonment.formViews} />
          <Stat label="Submits" value={data.abandonment.submits} />
          <Stat label="Abandoned" value={data.abandonment.abandoned} />
          <Stat
            label="Abandonment rate"
            value={data.abandonment.rate == null ? "—" : `${data.abandonment.rate}%`}
          />
        </div>
      ) : null}

      <div className="grid lg:grid-cols-3 gap-8">
        <Breakdown
          title="By inquiry type"
          hrefFor={(key) => `/admin/contact?inquiryType=${encodeURIComponent(key)}`}
          rows={data.byInquiryType.map((r) => ({ key: r.inquiryType, count: r.count }))}
        />
        <Breakdown title="By qualification" rows={data.byQualification.map((r) => ({ key: r.status, count: r.count }))} />
        <Breakdown title="By country" rows={data.byCountry.map((r) => ({ key: r.country, count: r.count }))} />
      </div>

      <Breakdown title="Canonical events" rows={data.events.map((r) => ({ key: r.event, count: r.count }))} />

      <section className="border border-white/10 rounded-xl p-4 text-sm text-ink space-y-2">
        <h2 className="text-white font-medium">Metric definitions</h2>
        {Object.entries(data.definitions).map(([k, v]) => (
          <p key={k}>
            <span className="text-white font-mono text-xs">{k}</span> — {v}
          </p>
        ))}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="border border-white/10 rounded-xl p-4" role="group" aria-label={`${label}: ${value}`}>
      <p className="text-xs text-ink uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-semibold mt-1" aria-hidden="true">
        {value}
      </p>
      {hint ? <p className="text-xs text-ink mt-1">{hint}</p> : null}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  hrefFor,
}: {
  title: string;
  rows: Array<{ key: string; count: number }>;
  hrefFor?: (key: string) => string;
}) {
  return (
    <section aria-labelledby={`analytics-${title.replace(/\s+/g, "-").toLowerCase()}`}>
      <h2 id={`analytics-${title.replace(/\s+/g, "-").toLowerCase()}`} className="font-medium mb-3">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink">No data yet.</p>
      ) : (
        <table className="text-sm w-full max-w-sm">
          <caption className="sr-only">{title} counts</caption>
          <thead>
            <tr className="text-left text-ink">
              <th scope="col" className="font-normal pb-1">
                Category
              </th>
              <th scope="col" className="font-normal pb-1 text-right">
                Count
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-white/5">
                <th scope="row" className="py-1 font-normal truncate text-left">
                  {hrefFor && r.key ? (
                    <Link href={hrefFor(r.key)} className="text-lime hover:underline">
                      {r.key}
                    </Link>
                  ) : (
                    <span className="truncate">{r.key || "(none)"}</span>
                  )}
                </th>
                <td className="py-1 font-mono text-right shrink-0">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
