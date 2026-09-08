import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import {
  actPlatformConfigChange,
  createPlatformConfigChange,
  getPlatformContactConfig,
  listPlatformConfigChanges,
  listPlatformContactTemplates,
  updatePlatformMacro,
  updatePlatformNotificationPolicy,
  updatePlatformTag,
} from "@workspace/api-client-react";

type TabId =
  | "templates"
  | "taxonomy"
  | "qualification"
  | "routing"
  | "workflows"
  | "sla"
  | "meetings"
  | "tags"
  | "changes";

const TABS: { id: TabId; label: string }[] = [
  { id: "templates", label: "Templates" },
  { id: "taxonomy", label: "Taxonomy" },
  { id: "qualification", label: "Qualification" },
  { id: "routing", label: "Routing" },
  { id: "workflows", label: "Workflows" },
  { id: "sla", label: "SLA" },
  { id: "meetings", label: "Meetings" },
  { id: "tags", label: "Tags/Macros" },
  { id: "changes", label: "Change control" },
];

const QUAL_THRESHOLDS = ["HIGH_PRIORITY", "SALES_QUALIFIED", "MARKETING_QUALIFIED"] as const;
const ROUTING_STRATEGIES = ["round_robin", "team", "staff"] as const;
const ACTIVE_STATUSES = ["active", "disabled"] as const;

const inputClass =
  "rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm w-full text-paper placeholder:text-ink-muted";
const cardClass = "border border-white/10 rounded-xl p-4 bg-white/[0.02] space-y-3";
const labelClass = "block text-xs text-ink mb-1";

type JsonMap = Record<string, unknown>;

interface TaxonomyRow {
  id: string;
  kind: string;
  key: string;
  parentKey: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

interface QualificationModel {
  id: string;
  key: string;
  name: string;
  version: number;
  status: string;
  thresholds: JsonMap;
  rules: JsonMap[];
}

interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  status: string;
  strategy: string;
}

interface WorkflowRow {
  id: string;
  key: string;
  name: string;
  status: string;
  version: number;
  trigger: string;
}

interface SlaPolicy {
  id: string;
  key: string;
  name: string;
  version: number;
  status: string;
  firstResponseMinutes: number;
  nextResponseMinutes: number | null;
  resolutionMinutes: number | null;
}

interface MeetingType {
  id: string;
  key: string;
  name: string;
  bookingUrl: string;
  durationMinutes: number;
  timezone: string;
  status: string;
}

interface MacroRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  actions: JsonMap[];
}

interface TagRow {
  id: string;
  slug: string;
  label: string;
  color: string | null;
}

interface ConfigBundle {
  taxonomy: TaxonomyRow[];
  models: QualificationModel[];
  workflows: WorkflowRow[];
  routing: RoutingRule[];
  sla: SlaPolicy[];
  meetings: MeetingType[];
  macros: MacroRow[];
  tags: TagRow[];
  notificationPolicy?: { channels?: string[]; slaBreach?: boolean; assignment?: boolean };
}

interface SaveState {
  pending: boolean;
  ok: string | null;
  error: string | null;
}

const idleSave: SaveState = { pending: false, ok: null, error: null };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Save failed";
}

async function createDraftChange(
  entityType: string,
  entityId: string,
  beforeValue: JsonMap | null,
  afterValue: JsonMap,
) {
  return createPlatformConfigChange({
      entityType,
      entityId,
      afterValue,
      beforeValue: beforeValue ?? undefined,
    });
}

function thresholdNumber(thresholds: JsonMap, key: string): number {
  const raw = thresholds[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function parseOptionalMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export default function AdminConfig() {
  const [config, setConfig] = useState<ConfigBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("templates");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPlatformContactConfig();
      setConfig(data as ConfigBundle);
    } catch (err) {
      setError(errorMessage(err));
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleTabs = TABS;

  return (
    <div className="p-4 md:p-6 text-paper" data-testid="admin-config">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Contact configuration</h1>
        <p className="text-sm text-ink mt-1">Templates, taxonomy, qualification, routing, and operations policies.</p>
      </div>

      <div
        role="tablist"
        aria-label="Configuration sections"
        className="flex flex-wrap gap-2 mb-6 text-sm"
      >
        {visibleTabs.map((t, index) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
              e.preventDefault();
              const last = visibleTabs.length - 1;
              let next = index;
              if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
              if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
              if (e.key === "Home") next = 0;
              if (e.key === "End") next = last;
              setTab(visibleTabs[next].id);
            }}
            className={`px-3 py-1.5 rounded-lg capitalize ${
              tab === t.id ? "bg-white text-obsidian" : "bg-white/10 text-paper hover:bg-white/15"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "templates" ? (
        <TemplatesPanel />
      ) : tab === "changes" ? (
        <ChangesPanel />
      ) : loading ? (
        <p className="text-ink">Loading configuration…</p>
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => void load()} />
      ) : !config ? (
        <p className="text-ink">No configuration loaded.</p>
      ) : (
        <>
          {tab === "taxonomy" && <TaxonomyPanel rows={config.taxonomy} onSaved={load} />}
          {tab === "qualification" && <QualificationPanel models={config.models} onSaved={load} />}
          {tab === "routing" && <RoutingPanel rules={config.routing} onSaved={load} />}
          {tab === "workflows" && <WorkflowsPanel rows={config.workflows} onSaved={load} />}
          {tab === "sla" && <SlaPanel policies={config.sla} onSaved={load} />}
          {tab === "meetings" && <MeetingsPanel types={config.meetings} onSaved={load} />}
          {tab === "tags" && <TagsMacrosPanel tags={config.tags} macros={config.macros} notificationPolicy={config.notificationPolicy} onSaved={load} />}
        </>
      )}
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm space-y-2">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="text-lime hover:underline">
        Retry
      </button>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-ink text-sm py-8 text-center">{children}</p>;
}

function StatusPill({ value }: { value: string }) {
  const on = value === "active" || value === "published";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide ${
        on ? "bg-lime/15 text-lime" : "bg-white/10 text-ink"
      }`}
    >
      {value}
    </span>
  );
}

function SaveBar({ save, label = "Save" }: { save: SaveState; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={save.pending}
        className="px-3 py-1.5 rounded-lg bg-lime text-obsidian text-sm font-medium disabled:opacity-50"
      >
        {save.pending ? "Saving…" : label}
      </button>
      {save.ok && <span className="text-xs text-lime">{save.ok}</span>}
      {save.error && <span className="text-xs text-red-400">{save.error}</span>}
    </div>
  );
}

function TemplatesPanel() {
  const [data, setData] = useState<{
    templates: Array<{ id: string; key: string; internalName: string; status: string; category: string }>;
    versions: Array<{ templateId: string; versionNumber: number; language: string; subject: string; body: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishMsg, setPublishMsg] = useState<Record<string, { ok?: string; error?: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listPlatformContactTemplates());
    } catch (err) {
      setError(errorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-ink">Loading templates…</p>;
  if (error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!data?.templates.length) return <EmptyState>No email templates yet.</EmptyState>;

  return (
    <div className="space-y-4">
      {data.templates.map((t) => {
        const versions = data.versions.filter((v) => v.templateId === t.id);
        const latest = [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
        const msg = publishMsg[t.id];
        return (
          <article key={t.id} className={cardClass}>
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-medium">{t.internalName}</p>
                <p className="text-xs text-ink mt-1">
                  {t.key} · {t.category}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill value={t.status} />
                {t.status !== "published" && (
                  <button
                    type="button"
                    disabled={publishingId === t.id}
                    className="text-sm text-lime disabled:opacity-50"
                    onClick={async () => {
                      setPublishingId(t.id);
                      setPublishMsg((prev) => ({ ...prev, [t.id]: {} }));
                      try {
                        await createDraftChange("template_publish", t.id, { status: t.status }, { status: "published" });
                        setPublishMsg((prev) => ({ ...prev, [t.id]: { ok: "Draft created — publish from Change control" } }));
                        await load();
                      } catch (err) {
                        setPublishMsg((prev) => ({ ...prev, [t.id]: { error: errorMessage(err) } }));
                      } finally {
                        setPublishingId(null);
                      }
                    }}
                  >
                    {publishingId === t.id ? "Saving…" : "Submit publish draft"}
                  </button>
                )}
              </div>
            </div>
            {msg?.ok && <p className="text-xs text-lime">{msg.ok}</p>}
            {msg?.error && <p className="text-xs text-red-400">{msg.error}</p>}
            {latest ? (
              <div className="mt-1 space-y-2 text-sm">
                <p className="text-ink">
                  Version {latest.versionNumber} · {latest.language}
                </p>
                <div>
                  <p className={labelClass}>Subject</p>
                  <p className="font-medium">{latest.subject}</p>
                </div>
                <div>
                  <p className={labelClass}>Body</p>
                  <div className="whitespace-pre-wrap text-ink text-xs leading-relaxed rounded-lg bg-black/20 border border-white/5 p-3">
                    {latest.body}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink">No versions yet.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function TaxonomyPanel({ rows, onSaved }: { rows: TaxonomyRow[]; onSaved: () => Promise<void> }) {
  if (!rows.length) return <EmptyState>No taxonomy items.</EmptyState>;
  const grouped = rows.reduce<Record<string, TaxonomyRow[]>>((acc, row) => {
    (acc[row.kind] ??= []).push(row);
    return acc;
  }, {});
  return (
    <div className="space-y-8">
      {Object.entries(grouped).map(([kind, items]) => (
        <section key={kind}>
          <h2 className="font-medium mb-3 capitalize">{kind.replace(/_/g, " ")}</h2>
          <div className="space-y-3">
            {[...items]
              .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
              .map((item) => (
                <TaxonomyEditor key={item.id} item={item} onSaved={onSaved} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaxonomyEditor({ item, onSaved }: { item: TaxonomyRow; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(item.label);
  const [active, setActive] = useState(item.active);
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder));
  const [save, setSave] = useState<SaveState>(idleSave);

  useEffect(() => {
    setLabel(item.label);
    setActive(item.active);
    setSortOrder(String(item.sortOrder));
  }, [item]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const order = Number(sortOrder);
    if (!Number.isFinite(order)) {
      setSave({ pending: false, ok: null, error: "Sort order must be a number." });
      return;
    }
    setSave({ pending: true, ok: null, error: null });
    try {
      await createDraftChange(
        "taxonomy",
        item.id,
        { label: item.label, sortOrder: item.sortOrder, active: item.active },
        { label: label.trim(), sortOrder: order, active },
      );
      setSave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
      await onSaved();
    } catch (err) {
      setSave({ pending: false, ok: null, error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={cardClass}>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-ink">
        <span>
          {item.key}
          {item.parentKey ? ` · parent ${item.parentKey}` : ""}
        </span>
        <StatusPill value={active ? "active" : "disabled"} />
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor={`tax-label-${item.id}`}>
            Label
          </label>
          <input id={`tax-label-${item.id}`} className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`tax-sort-${item.id}`}>
            Sort order
          </label>
          <input
            id={`tax-sort-${item.id}`}
            className={inputClass}
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>
      <SaveBar save={save} />
    </form>
  );
}

function QualificationPanel({
  models,
  onSaved,
}: {
  models: QualificationModel[];
  onSaved: () => Promise<void>;
}) {
  if (!models.length) return <EmptyState>No qualification models.</EmptyState>;
  return (
    <div className="space-y-4">
      {models.map((model) => (
        <QualificationEditor key={model.id} model={model} onSaved={onSaved} />
      ))}
    </div>
  );
}

function QualificationEditor({
  model,
  onSaved,
}: {
  model: QualificationModel;
  onSaved: () => Promise<void>;
}) {
  const [thresholds, setThresholds] = useState(() =>
    Object.fromEntries(QUAL_THRESHOLDS.map((k) => [k, String(thresholdNumber(model.thresholds, k))])),
  );
  const [save, setSave] = useState<SaveState>(idleSave);

  useEffect(() => {
    setThresholds(Object.fromEntries(QUAL_THRESHOLDS.map((k) => [k, String(thresholdNumber(model.thresholds, k))])));
  }, [model]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: JsonMap = { ...model.thresholds };
    for (const key of QUAL_THRESHOLDS) {
      const n = Number(thresholds[key]);
      if (!Number.isFinite(n)) {
        setSave({ pending: false, ok: null, error: `${key} must be a number.` });
        return;
      }
      next[key] = n;
    }
    setSave({ pending: true, ok: null, error: null });
    try {
      await createPlatformConfigChange({
          entityType: "qualification_model",
          entityId: model.id,
          beforeValue: model.thresholds,
          afterValue: { name: model.name, thresholds: next, rules: model.rules },
        });
      setSave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
      await onSaved();
    } catch (err) {
      setSave({ pending: false, ok: null, error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={cardClass}>
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="font-medium">{model.name}</p>
          <p className="text-xs text-ink mt-1">
            {model.key} · v{model.version}
          </p>
        </div>
        <StatusPill value={model.status} />
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {QUAL_THRESHOLDS.map((key) => (
          <div key={key}>
            <label className={labelClass} htmlFor={`th-${model.id}-${key}`}>
              {key.replace(/_/g, " ")}
            </label>
            <input
              id={`th-${model.id}-${key}`}
              className={inputClass}
              type="number"
              value={thresholds[key] ?? ""}
              onChange={(e) => setThresholds((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-ink">{model.rules.length} scoring rules (unchanged on save)</p>
      <SaveBar save={save} label="Save draft for review" />
    </form>
  );
}

function RoutingPanel({ rules, onSaved }: { rules: RoutingRule[]; onSaved: () => Promise<void> }) {
  if (!rules.length) return <EmptyState>No routing rules.</EmptyState>;
  return (
    <div className="space-y-4">
      {[...rules]
        .sort((a, b) => a.priority - b.priority)
        .map((rule) => (
          <RoutingEditor key={rule.id} rule={rule} onSaved={onSaved} />
        ))}
    </div>
  );
}

function RoutingEditor({ rule, onSaved }: { rule: RoutingRule; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(rule.name);
  const [priority, setPriority] = useState(String(rule.priority));
  const [strategy, setStrategy] = useState(rule.strategy);
  const [status, setStatus] = useState(rule.status);
  const [save, setSave] = useState<SaveState>(idleSave);

  useEffect(() => {
    setName(rule.name);
    setPriority(String(rule.priority));
    setStrategy(rule.strategy);
    setStatus(rule.status);
  }, [rule]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const p = Number(priority);
    if (!Number.isFinite(p)) {
      setSave({ pending: false, ok: null, error: "Priority must be a number." });
      return;
    }
    setSave({ pending: true, ok: null, error: null });
    try {
      await createDraftChange(
        "routing_rule",
        rule.id,
        { name: rule.name, priority: rule.priority, strategy: rule.strategy, status: rule.status },
        { name: name.trim(), priority: p, strategy, status },
      );
      setSave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
      await onSaved();
    } catch (err) {
      setSave({ pending: false, ok: null, error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={cardClass}>
      <div className="flex justify-end">
        <StatusPill value={status} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor={`rt-name-${rule.id}`}>
            Name
          </label>
          <input id={`rt-name-${rule.id}`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`rt-pri-${rule.id}`}>
            Priority
          </label>
          <input
            id={`rt-pri-${rule.id}`}
            className={inputClass}
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`rt-st-${rule.id}`}>
            Strategy
          </label>
          <select id={`rt-st-${rule.id}`} className={inputClass} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            {!ROUTING_STRATEGIES.includes(strategy as (typeof ROUTING_STRATEGIES)[number]) && (
              <option value={strategy}>{strategy}</option>
            )}
            {ROUTING_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`rt-status-${rule.id}`}>
            Status
          </label>
          <select id={`rt-status-${rule.id}`} className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {ACTIVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <SaveBar save={save} />
    </form>
  );
}

function WorkflowsPanel({ rows, onSaved }: { rows: WorkflowRow[]; onSaved: () => Promise<void> }) {
  if (!rows.length) return <EmptyState>No workflows.</EmptyState>;
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <WorkflowEditor key={row.id} row={row} onSaved={onSaved} />
      ))}
    </div>
  );
}

function WorkflowEditor({ row, onSaved }: { row: WorkflowRow; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(row.name);
  const [status, setStatus] = useState(row.status);
  const [save, setSave] = useState<SaveState>(idleSave);

  useEffect(() => {
    setName(row.name);
    setStatus(row.status);
  }, [row]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSave({ pending: true, ok: null, error: null });
    try {
      await createDraftChange("workflow", row.id, { name: row.name, status: row.status }, { name: name.trim(), status });
      setSave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
      await onSaved();
    } catch (err) {
      setSave({ pending: false, ok: null, error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={cardClass}>
      <div className="flex flex-wrap justify-between gap-2">
        <p className="text-xs text-ink">
          {row.key} · v{row.version} · {row.trigger}
        </p>
        <StatusPill value={status} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`wf-name-${row.id}`}>
            Name
          </label>
          <input id={`wf-name-${row.id}`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`wf-status-${row.id}`}>
            Status
          </label>
          <select id={`wf-status-${row.id}`} className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {ACTIVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <SaveBar save={save} />
    </form>
  );
}

function SlaPanel({ policies, onSaved }: { policies: SlaPolicy[]; onSaved: () => Promise<void> }) {
  if (!policies.length) return <EmptyState>No SLA policies.</EmptyState>;
  return (
    <div className="space-y-4">
      {policies.map((policy) => (
        <SlaEditor key={policy.id} policy={policy} onSaved={onSaved} />
      ))}
    </div>
  );
}

function SlaEditor({ policy, onSaved }: { policy: SlaPolicy; onSaved: () => Promise<void> }) {
  const [first, setFirst] = useState(String(policy.firstResponseMinutes));
  const [next, setNext] = useState(policy.nextResponseMinutes == null ? "" : String(policy.nextResponseMinutes));
  const [resolution, setResolution] = useState(
    policy.resolutionMinutes == null ? "" : String(policy.resolutionMinutes),
  );
  const [holidays, setHolidays] = useState(((policy as SlaPolicy & { holidays?: string[] }).holidays ?? []).join(", "));
  const [timeZone, setTimeZone] = useState((policy as SlaPolicy & { timeZone?: string }).timeZone ?? "UTC");
  const [save, setSave] = useState<SaveState>(idleSave);

  useEffect(() => {
    setFirst(String(policy.firstResponseMinutes));
    setNext(policy.nextResponseMinutes == null ? "" : String(policy.nextResponseMinutes));
    setResolution(policy.resolutionMinutes == null ? "" : String(policy.resolutionMinutes));
    setHolidays(((policy as SlaPolicy & { holidays?: string[] }).holidays ?? []).join(", "));
    setTimeZone((policy as SlaPolicy & { timeZone?: string }).timeZone ?? "UTC");
  }, [policy]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const firstN = Number(first);
    if (!Number.isFinite(firstN)) {
      setSave({ pending: false, ok: null, error: "First response minutes must be a number." });
      return;
    }
    setSave({ pending: true, ok: null, error: null });
    try {
      await createDraftChange(
        "sla_policy",
        policy.id,
        {
          firstResponseMinutes: policy.firstResponseMinutes,
          nextResponseMinutes: policy.nextResponseMinutes,
          resolutionMinutes: policy.resolutionMinutes,
        },
        {
          firstResponseMinutes: firstN,
          nextResponseMinutes: parseOptionalMinutes(next),
          resolutionMinutes: parseOptionalMinutes(resolution),
          holidays: holidays
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          timeZone,
        },
      );
      setSave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
      await onSaved();
    } catch (err) {
      setSave({ pending: false, ok: null, error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={cardClass}>
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="font-medium">{policy.name}</p>
          <p className="text-xs text-ink mt-1">
            {policy.key} · v{policy.version}
          </p>
        </div>
        <StatusPill value={policy.status} />
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className={labelClass} htmlFor={`sla-first-${policy.id}`}>
            First response (minutes)
          </label>
          <input
            id={`sla-first-${policy.id}`}
            className={inputClass}
            type="number"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`sla-next-${policy.id}`}>
            Next response (minutes)
          </label>
          <input
            id={`sla-next-${policy.id}`}
            className={inputClass}
            type="number"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`sla-res-${policy.id}`}>
            Resolution (minutes)
          </label>
          <input
            id={`sla-res-${policy.id}`}
            className={inputClass}
            type="number"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`sla-tz-${policy.id}`}>
            Time zone (IANA)
          </label>
          <input
            id={`sla-tz-${policy.id}`}
            className={inputClass}
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`sla-hol-${policy.id}`}>
            Holidays (YYYY-MM-DD, comma-separated)
          </label>
          <input
            id={`sla-hol-${policy.id}`}
            className={inputClass}
            value={holidays}
            onChange={(e) => setHolidays(e.target.value)}
          />
        </div>
      </div>
      <SaveBar save={save} />
    </form>
  );
}

function MeetingsPanel({ types, onSaved }: { types: MeetingType[]; onSaved: () => Promise<void> }) {
  if (!types.length) return <EmptyState>No meeting types.</EmptyState>;
  return (
    <div className="space-y-4">
      {types.map((type) => (
        <MeetingEditor key={type.id} type={type} onSaved={onSaved} />
      ))}
    </div>
  );
}

function MeetingEditor({ type, onSaved }: { type: MeetingType; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(type.name);
  const [bookingUrl, setBookingUrl] = useState(type.bookingUrl);
  const [duration, setDuration] = useState(String(type.durationMinutes));
  const [save, setSave] = useState<SaveState>(idleSave);

  useEffect(() => {
    setName(type.name);
    setBookingUrl(type.bookingUrl);
    setDuration(String(type.durationMinutes));
  }, [type]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const minutes = Number(duration);
    if (!Number.isFinite(minutes)) {
      setSave({ pending: false, ok: null, error: "Duration must be a number." });
      return;
    }
    setSave({ pending: true, ok: null, error: null });
    try {
      await createDraftChange(
        "meeting_type",
        type.id,
        { name: type.name, bookingUrl: type.bookingUrl, durationMinutes: type.durationMinutes },
        { name: name.trim(), bookingUrl: bookingUrl.trim(), durationMinutes: minutes },
      );
      setSave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
      await onSaved();
    } catch (err) {
      setSave({ pending: false, ok: null, error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={cardClass}>
      <div className="flex flex-wrap justify-between gap-2">
        <p className="text-xs text-ink">
          {type.key} · {type.timezone}
        </p>
        <StatusPill value={type.status} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`mt-name-${type.id}`}>
            Name
          </label>
          <input id={`mt-name-${type.id}`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`mt-dur-${type.id}`}>
            Duration (minutes)
          </label>
          <input
            id={`mt-dur-${type.id}`}
            className={inputClass}
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor={`mt-url-${type.id}`}>
            Booking URL
          </label>
          <input
            id={`mt-url-${type.id}`}
            className={inputClass}
            type="url"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
          />
        </div>
      </div>
      <SaveBar save={save} />
    </form>
  );
}

function TagsMacrosPanel({
  tags,
  macros,
  notificationPolicy,
  onSaved,
}: {
  tags: TagRow[];
  macros: MacroRow[];
  notificationPolicy?: { channels?: string[]; slaBreach?: boolean; assignment?: boolean };
  onSaved: () => Promise<void>;
}) {
  const [policySave, setPolicySave] = useState<SaveState>(idleSave);
  const [slaBreach, setSlaBreach] = useState(notificationPolicy?.slaBreach ?? true);
  const [assignment, setAssignment] = useState(notificationPolicy?.assignment ?? true);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-medium mb-3">Notification policy</h2>
        <form
          className={cardClass}
          onSubmit={async (e) => {
            e.preventDefault();
            setPolicySave({ pending: true, ok: null, error: null });
            try {
              await updatePlatformNotificationPolicy({
                  channels: ["in_app"],
                  slaBreach,
                  assignment,
                  rationale: "Admin notification policy draft",
                });
              setPolicySave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
              await onSaved();
            } catch (err) {
              setPolicySave({ pending: false, ok: null, error: errorMessage(err) });
            }
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={slaBreach} onChange={(e) => setSlaBreach(e.target.checked)} />
            Notify on SLA breach
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={assignment} onChange={(e) => setAssignment(e.target.checked)} />
            Notify on assignment
          </label>
          <SaveBar save={policySave} />
        </form>
      </section>
      <section>
        <h2 className="font-medium mb-3">Tags</h2>
        {!tags.length ? (
          <EmptyState>No tags.</EmptyState>
        ) : (
          <div className="space-y-3">
            {tags.map((tag) => (
              <TagEditor key={tag.id} tag={tag} onSaved={onSaved} />
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="font-medium mb-3">Macros</h2>
        {!macros.length ? (
          <EmptyState>No macros.</EmptyState>
        ) : (
          <div className="space-y-3">
            {macros.map((macro) => (
              <MacroEditor key={macro.id} macro={macro} onSaved={onSaved} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TagEditor({ tag, onSaved }: { tag: TagRow; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(tag.label);
  const [save, setSave] = useState<SaveState>(idleSave);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSave({ pending: true, ok: null, error: null });
    try {
      await updatePlatformTag(tag.id, { label: label.trim(), rationale: "Tag label draft" });
      setSave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
      await onSaved();
    } catch (err) {
      setSave({ pending: false, ok: null, error: errorMessage(err) });
    }
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} className={cardClass}>
      <p className="text-xs text-ink font-mono">{tag.slug}</p>
      <label className={labelClass} htmlFor={`tag-${tag.id}`}>
        Label
      </label>
      <input id={`tag-${tag.id}`} className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
      <SaveBar save={save} />
    </form>
  );
}

function MacroEditor({ macro, onSaved }: { macro: MacroRow; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(macro.name);
  const [save, setSave] = useState<SaveState>(idleSave);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSave({ pending: true, ok: null, error: null });
    try {
      await updatePlatformMacro(macro.id, { name: name.trim(), rationale: "Macro name draft" });
      setSave({ pending: false, ok: "Draft change created — submit it under Change control", error: null });
      await onSaved();
    } catch (err) {
      setSave({ pending: false, ok: null, error: errorMessage(err) });
    }
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} className={cardClass}>
      <p className="text-xs text-ink font-mono">{macro.key}</p>
      <label className={labelClass} htmlFor={`macro-${macro.id}`}>
        Name
      </label>
      <input id={`macro-${macro.id}`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      <SaveBar save={save} />
    </form>
  );
}

function ChangesPanel() {
  const [items, setItems] = useState<
    Array<{
      id: string;
      entityType: string;
      entityId: string;
      status: string;
      summary: string | null;
      warnings: string[];
      updatedAt?: string;
      lockVersion?: number;
      publishedVersion?: number | null;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await listPlatformConfigChanges();
      setItems((data.items ?? []) as Array<{
        id: string;
        entityType: string;
        entityId: string;
        status: string;
        summary: string | null;
        warnings: string[];
        updatedAt?: string;
        lockVersion?: number;
        publishedVersion?: number | null;
      }>);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    id: string,
    action: "submit_review" | "approve" | "reject" | "publish" | "rollback" | "revise",
    row?: { lockVersion?: number; publishedVersion?: number | null },
  ) {
    setBusy(`${id}:${action}`);
    try {
      await actPlatformConfigChange(id, action, {
          expectedLockVersion: Number(row?.lockVersion ?? 0),
          expectedPublishedVersion:
            action === "publish" || action === "rollback"
              ? Number(row?.publishedVersion ?? 0)
              : undefined,
        });
      await load();
    } catch (err) {
      const conflict = err instanceof Error && "status" in err && (err as { status?: number }).status === 409;
      setError(conflict ? `${errorMessage(err)} Refresh the list and retry.` : errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-ink">Loading change requests…</p>;
  if (error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!items.length) {
    return <EmptyState>No configuration changes yet. Save a qualification draft to create one.</EmptyState>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        Draft → submit review → a different reviewer approves → a publisher publishes. Authors cannot approve their own changes. Emergency bypass is disabled unless CRM_CONFIG_EMERGENCY_BYPASS=true.
      </p>
      {items.map((row) => (
        <article key={row.id} className={cardClass}>
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <p className="font-medium">
                {row.entityType} · {row.entityId.slice(0, 8)}
              </p>
              <p className="text-xs text-ink mt-1">{row.summary}</p>
            </div>
            <StatusPill value={row.status} />
          </div>
          {row.warnings?.length ? (
            <ul className="text-xs text-amber-300 list-disc pl-4">
              {row.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2 text-sm">
            {row.status === "draft" && (
              <button type="button" className="text-lime" disabled={!!busy} onClick={() => void act(row.id, "submit_review", row)}>
                Submit for review
              </button>
            )}
            {row.status === "in_review" && (
              <>
                <button type="button" className="text-lime" disabled={!!busy} onClick={() => void act(row.id, "approve", row)}>
                  Approve
                </button>
                <button type="button" className="text-ink" disabled={!!busy} onClick={() => void act(row.id, "reject", row)}>
                  Reject
                </button>
              </>
            )}
            {row.status === "approved" && (
              <button
                type="button"
                className="text-lime"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm("Publish this change to production configuration?")) return;
                  void act(row.id, "publish", row);
                }}
              >
                Publish
              </button>
            )}
            {row.status === "published" && (
              <button
                type="button"
                className="text-ink"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm("Roll this change back to the previous published value?")) return;
                  void act(row.id, "rollback", row);
                }}
              >
                Rollback
              </button>
            )}
            {(row.status === "rejected" || row.status === "in_review") && (
              <button type="button" className="text-ink" disabled={!!busy} onClick={() => void act(row.id, "revise", row)}>
                Return to draft
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
