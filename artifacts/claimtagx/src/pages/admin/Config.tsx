import { useEffect, useState } from "react";
import { platformFetch } from "@/lib/contactApi";

export default function AdminConfig() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState("templates");

  async function load() {
    setConfig(await platformFetch("/api/platform/contact/config"));
  }
  useEffect(() => {
    void load();
  }, []);

  if (!config) return <div className="p-8 text-slate">Loading configuration…</div>;
  const templates = (config as { templates?: never }).templates;
  void templates;

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-semibold mb-4">Contact configuration</h1>
      <div className="flex flex-wrap gap-2 mb-6 text-sm">
        {["templates", "qualification", "routing", "workflows", "sla", "meetings", "taxonomy"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg ${tab === t ? "bg-white text-obsidian" : "bg-white/10"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "templates" && <Templates />}
      {tab === "qualification" && <JsonList title="Qualification models" rows={(config as { models: unknown[] }).models} />}
      {tab === "routing" && <JsonList title="Routing rules" rows={(config as { routing: unknown[] }).routing} />}
      {tab === "workflows" && <JsonList title="Workflows" rows={(config as { workflows: unknown[] }).workflows} />}
      {tab === "sla" && <JsonList title="SLA policies" rows={(config as { sla: unknown[] }).sla} />}
      {tab === "meetings" && <JsonList title="Meeting types" rows={(config as { meetings: unknown[] }).meetings} />}
      {tab === "taxonomy" && <JsonList title="Taxonomy" rows={(config as { taxonomy: unknown[] }).taxonomy} />}
    </div>
  );
}

function JsonList({ title, rows }: { title: string; rows: unknown[] }) {
  return (
    <div>
      <h2 className="font-medium mb-3">{title}</h2>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <pre key={i} className="text-xs bg-white/5 border border-white/10 rounded-xl p-4 overflow-auto max-h-64">
            {JSON.stringify(row, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
}

function Templates() {
  const [data, setData] = useState<{
    templates: Array<{ id: string; key: string; internalName: string; status: string; category: string }>;
    versions: Array<{ templateId: string; versionNumber: number; language: string; subject: string; body: string }>;
  } | null>(null);

  useEffect(() => {
    platformFetch("/api/platform/contact/templates").then(setData);
  }, []);
  if (!data) return null;
  return (
    <div className="space-y-4">
      {data.templates.map((t) => {
        const versions = data.versions.filter((v) => v.templateId === t.id);
        const latest = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
        return (
          <article key={t.id} className="border border-white/10 rounded-xl p-4">
            <div className="flex justify-between gap-3">
              <div>
                <p className="font-medium">{t.internalName}</p>
                <p className="text-xs text-slate">{t.key} · {t.status} · {t.category}</p>
              </div>
              {t.status !== "published" && (
                <button
                  className="text-sm text-lime"
                  onClick={async () => {
                    await platformFetch(`/api/platform/contact/templates/${t.id}/publish`, { method: "POST" });
                    setData(await platformFetch("/api/platform/contact/templates"));
                  }}
                >
                  Publish
                </button>
              )}
            </div>
            {latest && (
              <div className="mt-3 text-sm">
                <p className="text-slate">v{latest.versionNumber} · {latest.language}</p>
                <p className="font-medium mt-1">{latest.subject}</p>
                <pre className="whitespace-pre-wrap text-slate mt-2 text-xs">{latest.body}</pre>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
