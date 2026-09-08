import { useEffect, useState } from "react";
import {
  listPlatformDeadLetterJobs,
  listPlatformJobEffects,
  reconcilePlatformJobEffect,
  replayPlatformDeadLetterJob,
  replayPlatformJobEffect,
} from "@workspace/api-client-react";

type EffectRow = {
  key: string;
  kind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  jobId: string | null;
  providerMessageId: string | null;
  updatedAt: string;
  nextAttemptAt: string | null;
};

export default function AdminOperations() {
  const [effects, setEffects] = useState<EffectRow[]>([]);
  const [deadJobs, setDeadJobs] = useState<Array<{ id: string; type: string; lastError: string | null; attempts: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [replayKey, setReplayKey] = useState<string | null>(null);
  const [replayReason, setReplayReason] = useState("");
  const [jobReplayId, setJobReplayId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [effectsData, deadData] = await Promise.all([
        listPlatformJobEffects(statusFilter ? { status: statusFilter } : undefined),
        listPlatformDeadLetterJobs().catch(() => ({ items: [] })),
      ]);
      setEffects(Array.isArray(effectsData?.effects) ? (effectsData.effects as EffectRow[]) : []);
      setDeadJobs(
        Array.isArray(deadData?.items)
          ? deadData.items.map((j) => ({
              id: String((j as { id?: string }).id ?? ""),
              type: String((j as { type?: string }).type ?? ""),
              lastError: ((j as { lastError?: string | null }).lastError ?? null) as string | null,
              attempts: Number((j as { attempts?: number }).attempts ?? 0),
            }))
          : [],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load effects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter]);

  async function reconcile(key: string) {
    await reconcilePlatformJobEffect(key);
    await load();
  }

  async function replay(key: string) {
    if (replayReason.trim().length < 5) return;
    await replayPlatformJobEffect(key, { reason: replayReason.trim() });
    setReplayKey(null);
    setReplayReason("");
    await load();
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl" data-testid="admin-operations">
      <div>
        <h1 className="text-2xl font-bold">Operations</h1>
        <p className="text-ink text-sm mt-1">
          Inspect durable job effects, reconcile uncertain email sends, and authorize replays.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-ink">
          Status
          <select
            className="ml-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="pending">pending</option>
            <option value="executing">executing</option>
            <option value="uncertain">uncertain</option>
            <option value="retryable_failed">retryable_failed</option>
            <option value="terminal_failed">terminal_failed</option>
            <option value="committed">committed</option>
          </select>
        </label>
        <button type="button" className="text-sm text-lime" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {loading && <p className="text-ink text-sm">Loading effects…</p>}
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}
        </p>
      )}

      <div
        className="overflow-x-auto rounded-xl border border-white/10"
        tabIndex={0}
        role="region"
        aria-label="Job effects table"
      >
        <table className="min-w-full text-sm">
          <caption className="sr-only">Durable job effects</caption>
          <thead className="bg-white/5 text-ink">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Key</th>
              <th className="text-left px-4 py-3 font-medium">Kind</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Attempts</th>
              <th className="text-left px-4 py-3 font-medium">Updated</th>
              <th className="text-left px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {effects.map((row) => (
              <tr key={row.key} className="border-t border-white/5 align-top">
                <td className="px-4 py-3 font-mono text-xs break-all">{row.key}</td>
                <td className="px-4 py-3">{row.kind}</td>
                <td className="px-4 py-3">{row.status}</td>
                <td className="px-4 py-3">{row.attempts}</td>
                <td className="px-4 py-3 text-ink">{new Date(row.updatedAt).toLocaleString()}</td>
                <td className="px-4 py-3 space-y-2">
                  {row.status === "uncertain" && (
                    <button
                      type="button"
                      className="block text-lime text-xs"
                      onClick={() => void reconcile(row.key)}
                    >
                      Reconcile
                    </button>
                  )}
                  {(row.status === "terminal_failed" || row.status === "uncertain") && (
                    <button
                      type="button"
                      className="block text-lime text-xs"
                      onClick={() => setReplayKey(row.key)}
                    >
                      Replay
                    </button>
                  )}
                  {row.lastError && (
                    <p className="text-xs text-ink max-w-xs break-words">{row.lastError}</p>
                  )}
                </td>
              </tr>
            ))}
            {!loading && effects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink">
                  No effects match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {replayKey && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 max-w-lg">
          <p className="text-sm">Replay effect: {replayKey}</p>
          <textarea
            className="w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm min-h-24"
            placeholder="Reason (required, min 5 chars)"
            value={replayReason}
            onChange={(e) => setReplayReason(e.target.value)}
          />
          <div className="flex gap-3">
            <button
              type="button"
              className="bg-lime text-obsidian px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              disabled={replayReason.trim().length < 5}
              onClick={() => void replay(replayKey)}
            >
              Confirm replay
            </button>
            <button type="button" className="text-sm text-ink" onClick={() => setReplayKey(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <section className="space-y-3" data-testid="dead-letter-panel">
        <h2 className="text-lg font-semibold">Dead-letter jobs</h2>
        <p className="text-ink text-sm">Failed jobs awaiting authorized replay (`/jobs/dead`).</p>
        {deadJobs.length === 0 ? (
          <p className="text-sm text-ink">No dead-letter jobs.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {deadJobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 border border-white/10 rounded-lg px-3 py-2">
                <span className="font-mono text-xs">{job.id.slice(0, 8)}</span>
                <span>{job.type}</span>
                <span className="text-ink">attempts {job.attempts}</span>
                <span className="text-amber-200 truncate max-w-md">{job.lastError ?? "—"}</span>
                <button
                  type="button"
                  className="text-lime text-xs"
                  onClick={() => {
                    setJobReplayId(job.id);
                    setReplayReason("");
                  }}
                >
                  Replay
                </button>
              </li>
            ))}
          </ul>
        )}
        {jobReplayId ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 max-w-lg">
            <p className="text-sm">Replay dead job: {jobReplayId}</p>
            <textarea
              className="w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm min-h-24"
              placeholder="Reason (required, min 5 chars)"
              value={replayReason}
              onChange={(e) => setReplayReason(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                type="button"
                className="bg-lime text-obsidian px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                disabled={replayReason.trim().length < 5}
                onClick={async () => {
                  await replayPlatformDeadLetterJob(jobReplayId, { reason: replayReason.trim() });
                  setJobReplayId(null);
                  setReplayReason("");
                  await load();
                }}
              >
                Confirm job replay
              </button>
              <button type="button" className="text-sm text-ink" onClick={() => setJobReplayId(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
