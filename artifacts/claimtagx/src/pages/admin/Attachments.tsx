import { useCallback, useEffect, useState } from "react";
import { listPlatformAttachments, releasePlatformAttachmentQuarantine } from "@workspace/api-client-react";

type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  malwareStatus: string;
  malwareReason?: string | null;
  inquiryId?: string | null;
  contactId?: string | null;
  createdAt: string;
  deletedAt?: string | null;
};

export default function AdminAttachments() {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [filter, setFilter] = useState<"quarantined" | "pending" | "all">("quarantined");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listPlatformAttachments(filter === "all" ? undefined : { status: filter });
      setRows((data.attachments ?? []) as AttachmentRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load attachments");
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const release = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await releasePlatformAttachmentQuarantine(id, { reason: "admin manual review" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl" data-testid="admin-attachments">
      <div>
        <h1 className="text-2xl font-bold">Attachments quarantine</h1>
        <p className="text-ink text-sm mt-1">
          Object-level attachment review. Downloads remain blocked until malware status is clean. Releases are audited.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Attachment status filters">
        {(["quarantined", "pending", "all"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              filter === value ? "border-lime text-lime bg-lime/10" : "border-white/15 text-ink"
            }`}
          >
            {value}
          </button>
        ))}
        <button type="button" onClick={() => void load()} className="ms-auto text-sm text-lime">
          Refresh
        </button>
      </div>

      <div
        className="overflow-x-auto rounded-xl border border-white/10"
        tabIndex={0}
        role="region"
        aria-label="Attachments table"
      >
        <table className="min-w-full text-sm">
          <caption className="sr-only">Attachment quarantine review queue</caption>
          <thead className="bg-white/5 text-ink">
            <tr>
              <th className="text-start px-4 py-3 font-medium">File</th>
              <th className="text-start px-4 py-3 font-medium">Status</th>
              <th className="text-start px-4 py-3 font-medium">Size</th>
              <th className="text-start px-4 py-3 font-medium">Created</th>
              <th className="text-start px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-white/5">
                <td className="px-4 py-3">
                  <div className="font-medium">{row.filename}</div>
                  <div className="text-xs text-ink font-mono">{row.mimeType}</div>
                </td>
                <td className="px-4 py-3">
                  <div>{row.malwareStatus}</div>
                  {row.malwareReason && <div className="text-xs text-ink mt-1">{row.malwareReason}</div>}
                </td>
                <td className="px-4 py-3">{row.sizeBytes}</td>
                <td className="px-4 py-3 text-ink">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  {(row.malwareStatus === "quarantined" || row.malwareStatus === "pending") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void release(row.id)}
                      className="text-xs border border-white/15 rounded px-2 py-1 hover:border-lime/50 disabled:opacity-40"
                    >
                      Release to clean
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink">
                  No attachments for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
