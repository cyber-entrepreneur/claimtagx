import { useCallback, useEffect, useState } from "react";
import {
  comparePlatformMarketingVersions,
  createPlatformMarketingDocumentDraft,
  listPlatformMarketingDocumentAudit,
  listPlatformMarketingDocuments,
  listPlatformMarketingDocumentVersions,
  listPlatformMarketingPublishFailures,
  patchPlatformMarketingVersion,
  previewPlatformMarketingVersion,
  reconcilePlatformMarketingPublish,
  rollbackPlatformMarketingVersion,
  transitionPlatformMarketingVersion,
  type MarketingDocument,
  type MarketingVersion,
} from "@workspace/api-client-react";

const TRANSITIONS = [
  "submit_review",
  "request_changes",
  "approve",
  "reject",
  "schedule",
  "publish",
  "unpublish",
  "archive",
  "revise",
] as const;

type PublishFailure = {
  id: string;
  action: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

export default function AdminMarketing() {
  const [documents, setDocuments] = useState<MarketingDocument[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [versions, setVersions] = useState<MarketingVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<MarketingVersion | null>(null);
  const [compareRightId, setCompareRightId] = useState<string>("");
  const [diffs, setDiffs] = useState<{ field: string; before?: unknown; after?: unknown }[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [audit, setAudit] = useState<{ id: string; action: string; createdAt: string }[]>([]);
  const [publishFailures, setPublishFailures] = useState<PublishFailure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    slug: "home",
    locale: "en",
    title: "",
    summary: "",
    seoTitle: "",
    seoDescription: "",
  });
  const [editTitle, setEditTitle] = useState("");

  const loadDocuments = useCallback(async () => {
    setError(null);
    try {
      const data = await listPlatformMarketingDocuments();
      setDocuments(data.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketing documents");
    }
  }, []);

  const loadPublishFailures = useCallback(async (versionId: string) => {
    try {
      const data = await listPlatformMarketingPublishFailures(versionId);
      setPublishFailures((data.failures ?? []) as PublishFailure[]);
    } catch {
      setPublishFailures([]);
    }
  }, []);

  const loadVersions = useCallback(async (slug: string) => {
    setError(null);
    setSelectedSlug(slug);
    setSelectedVersion(null);
    setPreview(null);
    setDiffs([]);
    setPublishFailures([]);
    try {
      const data = await listPlatformMarketingDocumentVersions(slug);
      setVersions(data.versions);
      const auditData = await listPlatformMarketingDocumentAudit(slug);
      setAudit(auditData.audit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load versions");
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const createDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      await createPlatformMarketingDocumentDraft({
        slug: draft.slug,
        locale: draft.locale,
        title: draft.title,
        summary: draft.summary || undefined,
        seoTitle: draft.seoTitle || undefined,
        seoDescription: draft.seoDescription || undefined,
        body: { blocks: [] },
      });
      await loadDocuments();
      await loadVersions(draft.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create draft");
    } finally {
      setBusy(false);
    }
  };

  const transition = async (version: MarketingVersion, action: (typeof TRANSITIONS)[number]) => {
    setBusy(true);
    setError(null);
    try {
      await transitionPlatformMarketingVersion(version.id, {
        transition: action,
        expectedLockVersion: version.lockVersion,
        ...(action === "schedule"
          ? { scheduledAt: new Date(Date.now() + 60_000).toISOString() }
          : {}),
      });
      if (selectedSlug) await loadVersions(selectedSlug);
      if (action === "publish" || action === "unpublish") await loadPublishFailures(version.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Transition ${action} failed`);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!selectedVersion) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await patchPlatformMarketingVersion(selectedVersion.id, {
        expectedLockVersion: selectedVersion.lockVersion,
        title: editTitle || selectedVersion.title,
      });
      setSelectedVersion(updated.version);
      if (selectedSlug) await loadVersions(selectedSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async (version: MarketingVersion) => {
    setBusy(true);
    setError(null);
    try {
      const data = await previewPlatformMarketingVersion(version.id);
      setSelectedVersion(version);
      setEditTitle(version.title);
      setPreview(data.preview as Record<string, unknown>);
      await loadPublishFailures(version.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const runCompare = async () => {
    if (!selectedVersion || !compareRightId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await comparePlatformMarketingVersions(selectedVersion.id, compareRightId);
      setDiffs(data.diffs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (version: MarketingVersion) => {
    setBusy(true);
    setError(null);
    try {
      await rollbackPlatformMarketingVersion(version.id);
      if (selectedSlug) await loadVersions(selectedSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async (versionId: string, kind: "cache" | "notify" | "all") => {
    setBusy(true);
    setError(null);
    try {
      await reconcilePlatformMarketingPublish(versionId, { kind });
      await loadPublishFailures(versionId);
      if (selectedSlug) await loadVersions(selectedSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconcile failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl" data-testid="marketing-cms">
      <div>
        <h1 className="text-2xl font-bold">Marketing CMS</h1>
        <p className="text-ink text-sm mt-1">
          DB-backed editorial workflow via generated OpenAPI client. Dual-control transitions, lock
          versions, preview, compare, rollback, and immutable audit.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
          {error}
        </div>
      )}

      <section className="border border-white/10 rounded-xl p-4 space-y-3 bg-white/[0.02]">
        <h2 className="font-semibold">Create draft version</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            [
              ["slug", "Slug"],
              ["locale", "Locale"],
              ["title", "Title"],
              ["summary", "Summary"],
              ["seoTitle", "SEO title"],
              ["seoDescription", "SEO description"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-xs text-ink">
              {label}
              <input
                className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-paper"
                value={draft[key]}
                data-testid={key === "title" ? "cms-draft-title" : key === "slug" ? "cms-draft-slug" : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !draft.title || !draft.slug}
          data-testid="cms-create-draft"
          onClick={() => void createDraft()}
          className="bg-lime text-obsidian px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          Create draft
        </button>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section
          className="overflow-x-auto rounded-xl border border-white/10"
          tabIndex={0}
          aria-label="Marketing documents"
        >
          <table className="min-w-full text-sm">
            <caption className="sr-only">Marketing documents</caption>
            <thead className="bg-white/5 text-ink">
              <tr>
                <th className="text-start px-4 py-3 font-medium">Slug</th>
                <th className="text-start px-4 py-3 font-medium">Type</th>
                <th className="text-start px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  data-testid={`cms-doc-${doc.slug}`}
                  className={`border-t border-white/5 cursor-pointer hover:bg-white/5 ${selectedSlug === doc.slug ? "bg-lime/10" : ""}`}
                  onClick={() => void loadVersions(doc.slug)}
                >
                  <td className="px-4 py-3 font-mono text-xs">{doc.slug}</td>
                  <td className="px-4 py-3">{doc.contentType}</td>
                  <td className="px-4 py-3 text-ink">{new Date(doc.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {!documents.length && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-ink text-center">
                    No documents yet. Create a draft to begin governance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section
          className="overflow-x-auto rounded-xl border border-white/10"
          tabIndex={0}
          aria-label="Marketing document versions"
        >
          <div className="px-4 py-3 border-b border-white/10 text-sm text-ink">
            Versions {selectedSlug ? `for ${selectedSlug}` : "(select a document)"}
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-ink">
              <tr>
                <th className="text-start px-4 py-3 font-medium">v</th>
                <th className="text-start px-4 py-3 font-medium">Locale</th>
                <th className="text-start px-4 py-3 font-medium">Status</th>
                <th className="text-start px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-white/5 align-top">
                  <td className="px-4 py-3 font-mono text-xs">{v.version}</td>
                  <td className="px-4 py-3">{v.locale}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{v.status}</div>
                    <div className="text-xs text-ink mt-1">{v.title}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void loadPreview(v)}
                        className="text-[10px] uppercase tracking-wide border border-white/15 rounded px-2 py-1 hover:border-lime/50 disabled:opacity-40"
                      >
                        preview
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void rollback(v)}
                        className="text-[10px] uppercase tracking-wide border border-white/15 rounded px-2 py-1 hover:border-lime/50 disabled:opacity-40"
                      >
                        rollback
                      </button>
                      {TRANSITIONS.map((action) => (
                        <button
                          key={action}
                          type="button"
                          data-testid={`cms-transition-${action}`}
                          disabled={busy}
                          onClick={() => void transition(v, action)}
                          className="text-[10px] uppercase tracking-wide border border-white/15 rounded px-2 py-1 hover:border-lime/50 disabled:opacity-40"
                        >
                          {action.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {selectedSlug && !versions.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-ink text-center">
                    No versions for this document.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      {selectedVersion && (
        <section className="border border-white/10 rounded-xl p-4 space-y-3 bg-white/[0.02]">
          <h2 className="font-semibold">
            Edit / preview {selectedVersion.locale} v{selectedVersion.version}
          </h2>
          <label className="text-xs text-ink block">
            Title
            <input
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-paper"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveEdit()}
              className="bg-lime text-obsidian px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              Save draft edit
            </button>
            <label className="text-xs text-ink flex items-center gap-2">
              Compare with version id
              <input
                className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-sm text-paper font-mono"
                value={compareRightId}
                onChange={(e) => setCompareRightId(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !compareRightId}
              onClick={() => void runCompare()}
              className="border border-white/15 px-3 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              Compare
            </button>
          </div>
          {preview && (
            <pre className="text-xs overflow-auto max-h-48 bg-black/30 p-3 rounded-lg">{JSON.stringify(preview, null, 2)}</pre>
          )}
          {diffs.length > 0 && (
            <ul className="text-sm space-y-1">
              {diffs.map((d) => (
                <li key={d.field} className="font-mono text-xs">
                  {d.field}: {JSON.stringify(d.before)} → {JSON.stringify(d.after)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selectedSlug && (
        <section className="border border-white/10 rounded-xl p-4 space-y-2 bg-white/[0.02]">
          <h2 className="font-semibold">Audit — {selectedSlug}</h2>
          <ul className="text-xs font-mono space-y-1 max-h-48 overflow-auto">
            {audit.map((row) => (
              <li key={row.id}>
                {row.createdAt} {row.action}
              </li>
            ))}
            {!audit.length && <li className="text-ink">No audit rows.</li>}
          </ul>
        </section>
      )}

      <section
        className="border border-amber-500/30 rounded-xl p-4 space-y-3 bg-amber-500/5"
        data-testid="marketing-publish-failures"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Failed publication side effects</h2>
          {selectedVersion ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="text-xs border border-white/15 rounded px-2 py-1 hover:border-lime/50 disabled:opacity-40"
                onClick={() => void loadPublishFailures(selectedVersion.id)}
              >
                Refresh failures
              </button>
              <button
                type="button"
                disabled={busy}
                className="text-xs bg-lime text-obsidian rounded px-2 py-1 font-semibold disabled:opacity-40"
                onClick={() => void reconcile(selectedVersion.id, "all")}
              >
                Reconcile all
              </button>
              <button
                type="button"
                disabled={busy}
                className="text-xs border border-white/15 rounded px-2 py-1 disabled:opacity-40"
                onClick={() => void reconcile(selectedVersion.id, "cache")}
              >
                Retry cache
              </button>
              <button
                type="button"
                disabled={busy}
                className="text-xs border border-white/15 rounded px-2 py-1 disabled:opacity-40"
                onClick={() => void reconcile(selectedVersion.id, "notify")}
              >
                Retry notify
              </button>
            </div>
          ) : (
            <p className="text-xs text-ink">Select a version (preview) to inspect recoverable failures.</p>
          )}
        </div>
        {publishFailures.length === 0 ? (
          <p className="text-sm text-ink">No recoverable publish failures for the selected version.</p>
        ) : (
          <ul className="text-xs font-mono space-y-2">
            {publishFailures.map((row) => (
              <li key={row.id} className="border border-white/10 rounded-lg px-3 py-2">
                <div>
                  {row.createdAt} {row.action}
                </div>
                {row.metadata ? (
                  <pre className="mt-1 overflow-auto text-[10px] text-ink">{JSON.stringify(row.metadata)}</pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
