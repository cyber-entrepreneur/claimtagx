import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  bulkAssignPlatformInquiries,
  bulkMarkPlatformInquiriesRead,
  bulkStatusPlatformInquiries,
  createPlatformContactExport,
  createPlatformSavedView,
  deletePlatformSavedView,
  getPlatformMe,
  listPlatformContactInquiries,
  listPlatformContactStaff,
  listPlatformSavedViews,
  type ListPlatformContactInquiriesParams,
} from "@workspace/api-client-react";

function initialInquiryType(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("inquiryType") ?? "";
}

function PermissionGate({
  me,
  need,
  children,
}: {
  me?: { permissions: string[] };
  need: string;
  children: React.ReactNode;
}) {
  if (me && !me.permissions.includes(need) && !me.permissions.includes("*")) return null;
  return <>{children}</>;
}

interface Row {
  id: string;
  reference: string;
  createdAt: string;
  lastActivityAt: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  country: string;
  useCase: string[];
  qualificationStatus: string;
  leadScore: number;
  assignedTo: string | null;
  status: string;
  channel?: string;
  lastMessagePreview?: string;
  unread: boolean;
  slaStatus: string | null;
  slaDueAt: string | null;
}

const COLUMNS = [
  { key: "unread", label: "State" },
  { key: "channel", label: "Channel" },
  { key: "createdAt", label: "Date" },
  { key: "firstName", label: "First" },
  { key: "lastName", label: "Last" },
  { key: "company", label: "Company" },
  { key: "jobTitle", label: "Title" },
  { key: "country", label: "Country" },
  { key: "useCase", label: "Use case" },
  { key: "qualificationStatus", label: "Qualification" },
  { key: "leadScore", label: "Score" },
  { key: "assignedTo", label: "Assigned" },
  { key: "status", label: "Status" },
  { key: "lastActivityAt", label: "Last activity" },
  { key: "slaStatus", label: "SLA" },
] as const;

export default function AdminInbox() {
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [readState, setReadState] = useState("all");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [qual, setQual] = useState("");
  const [inquiryType, setInquiryType] = useState(initialInquiryType);
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [views, setViews] = useState<Array<{ id: string; name: string; filters: Record<string, string>; isDefault?: boolean }>>([]);
  const [viewName, setViewName] = useState("");
  const [activeView, setActiveView] = useState("");
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [assignTo, setAssignTo] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [me, setMe] = useState<{ permissions: string[] } | null>(null);

  useEffect(() => {
    setCursor("");
    setCursorHistory([]);
    setNextCursor(null);
  }, [search, readState, status, channel, qual, inquiryType, owner, priority, sort, dir]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (readState !== "all") p.set("readState", readState);
    if (status) p.set("status", status);
    if (channel) p.set("channel", channel);
    if (qual) p.set("qualificationStatus", qual);
    if (inquiryType) p.set("inquiryType", inquiryType);
    if (owner) p.set("assignedStaffId", owner);
    if (priority) p.set("priority", priority);
    p.set("sort", sort);
    p.set("dir", dir);
    p.set("limit", "50");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }, [search, readState, status, channel, qual, inquiryType, owner, priority, sort, dir, cursor]);

  async function load() {
    setLoading(true);
    try {
      const parsed = new URLSearchParams(query);
      const params: ListPlatformContactInquiriesParams = {
        search: parsed.get("search") || undefined,
        readState: (parsed.get("readState") as ListPlatformContactInquiriesParams["readState"]) || undefined,
        status: (parsed.get("status") as ListPlatformContactInquiriesParams["status"]) || undefined,
        qualificationStatus:
          (parsed.get("qualificationStatus") as ListPlatformContactInquiriesParams["qualificationStatus"]) || undefined,
        inquiryType: parsed.get("inquiryType") || undefined,
        channel: parsed.get("channel") || undefined,
        assignedStaffId: parsed.get("assignedStaffId") || undefined,
        ...(parsed.get("priority") ? { priority: parsed.get("priority") } : {}),
        sort: (parsed.get("sort") as ListPlatformContactInquiriesParams["sort"]) || undefined,
        dir: (parsed.get("dir") as ListPlatformContactInquiriesParams["dir"]) || undefined,
        limit: Number(parsed.get("limit") ?? 50),
        cursor: parsed.get("cursor") || undefined,
      } as ListPlatformContactInquiriesParams;
      const data = await listPlatformContactInquiries(params);
      setItems((data.items ?? []) as Row[]);
      setTotal(data.total ?? 0);
      setNextCursor((data as { nextCursor?: string | null }).nextCursor ?? null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    getPlatformMe()
      .then((row) => setMe({ permissions: row.permissions ?? [] }))
      .catch(() => setMe(null));
    listPlatformSavedViews()
      .then((rows) => {
        const mapped = rows.map((v) => ({
          id: v.id,
          name: v.name,
          filters: (v.filters ?? {}) as Record<string, string>,
          isDefault: Boolean((v as { isDefault?: boolean }).isDefault),
        }));
        setViews(mapped);
        const def = mapped.find((v) => v.isDefault);
        if (def?.filters) {
          const filters = def.filters as Record<string, string>;
          if (filters.search) setSearch(filters.search);
          if (filters.readState) setReadState(filters.readState);
          if (filters.status) setStatus(filters.status);
          if (filters.qualificationStatus) setQual(filters.qualificationStatus);
          setActiveView(def.id);
        }
      })
      .catch(() => undefined);
    listPlatformContactStaff()
      .then((d) => setStaff((d.staff ?? []).map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => undefined);
  }, []);

  function toggleSort(key: string) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key === "leadScore" ? "score" : key === "lastActivityAt" ? "lastActivityAt" : "createdAt");
      setDir("asc");
    }
  }

  async function bulk(unread: boolean) {
    if (!selected.length) return;
    await bulkMarkPlatformInquiriesRead({ ids: selected, unread });
    setSelected([]);
    await load();
  }

  return (
    <div
      className="p-4 md:p-6"
      data-testid="admin-inbox"
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        if (e.key === "j") setFocusIndex((i) => Math.min(items.length - 1, i + 1));
        if (e.key === "k") setFocusIndex((i) => Math.max(0, i - 1));
        if (e.key === "Enter" && items[focusIndex]) {
          window.location.href = `/admin/contact/${items[focusIndex].id}`;
        }
      }}
      tabIndex={0}
    >
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold">Unified inbox</h1>
          <p className="text-sm text-ink">{total} conversations</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs text-ink">
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, company, reference"
              data-testid="inbox-search"
              className="mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm w-64 block text-paper"
            />
          </label>
          <label className="text-xs text-ink">
            Read state
            <select value={readState} onChange={(e) => setReadState(e.target.value)} className="mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm block text-paper">
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
          </label>
          <label className="text-xs text-ink">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm block text-paper"
            >
              <option value="">Any status</option>
              {["NEW","TRIAGED","ASSIGNED","IN_PROGRESS","WAITING_FOR_CUSTOMER","WAITING_INTERNAL","RESOLVED","CLOSED","SPAM"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink">
            Channel
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm block text-paper"
            >
              <option value="">Any channel</option>
              {["website","web_form","email","whatsapp","messenger","instagram","x","tiktok","linkedin"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink">
            Owner
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm block text-paper"
            >
              <option value="">Any owner</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink">
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm block text-paper"
            >
              <option value="">Any priority</option>
              {["low","normal","high","urgent"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink">
            Qualification
            <select
              value={qual}
              onChange={(e) => setQual(e.target.value)}
              className="mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm block text-paper"
            >
              <option value="">Any qualification</option>
              {["UNASSESSED","MARKETING_QUALIFIED","SALES_QUALIFIED","HIGH_PRIORITY","DISQUALIFIED"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <button
            className="text-sm text-ink hover:text-white"
            onClick={() => {
              setSearch("");
              setReadState("all");
              setStatus("");
              setQual("");
              setOwner("");
              setPriority("");
              setActiveView("");
            }}
          >
            Clear filters
          </button>
          <label className="text-xs text-ink">
            Saved views
            <select
              value={activeView}
              data-testid="saved-views"
              aria-label="Saved views"
              onChange={(e) => {
                const id = e.target.value;
                setActiveView(id);
                const v = views.find((x) => x.id === id);
                if (!v) return;
                setSearch(v.filters.search ?? "");
                setReadState(v.filters.readState ?? "all");
                setStatus(v.filters.status ?? "");
                setQual(v.filters.qualificationStatus ?? "");
              }}
              className="mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm block text-paper"
            >
              <option value="">Saved views</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
          <input
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="View name"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm w-32"
          />
          <button
            className="text-sm px-3 py-2 rounded border border-white/10"
            data-testid="save-view"
            onClick={async () => {
              if (!viewName.trim()) return;
              const row = await createPlatformSavedView({
                  name: viewName.trim(),
                  filters: { search, readState, status, qualificationStatus: qual },
                });
              setViews((prev) => [
                ...prev,
                {
                  id: row.id,
                  name: row.name,
                  filters: (row.filters ?? {}) as Record<string, string>,
                },
              ]);
              setActiveView(row.id);
              setViewName("");
            }}
          >
            Save view
          </button>
          {activeView ? (
            <button
              className="text-sm px-3 py-2 rounded border border-white/10"
              onClick={async () => {
                await deletePlatformSavedView(activeView);
                setViews((prev) => prev.filter((v) => v.id !== activeView));
                setActiveView("");
              }}
            >
              Delete view
            </button>
          ) : null}
          <PermissionGate me={me ?? undefined} need="inquiries.export">
            <button
              type="button"
              data-testid="bulk-export"
              className="text-sm px-3 py-2 rounded border border-white/10"
              onClick={async () => {
                await createPlatformContactExport({ columns: ["reference", "status"], filters: { search } });
              }}
            >
              Export CSV
            </button>
          </PermissionGate>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 text-sm items-center" role="toolbar" aria-label="Bulk actions">
          <button onClick={() => bulk(false)} className="px-3 py-1 rounded border border-white/10">Mark read</button>
          <button onClick={() => bulk(true)} className="px-3 py-1 rounded border border-white/10">Mark unread</button>
          <PermissionGate me={me ?? undefined} need="inquiries.assign">
            <select
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              aria-label="Assign selected inquiries"
              className="rounded border border-white/10 bg-white/5 px-2 py-1"
            >
              <option value="">Assign to…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              className="px-3 py-1 rounded border border-white/10"
              onClick={async () => {
                if (!assignTo) return;
                if (!window.confirm(`Assign ${selected.length} inquiries?`)) return;
                setBulkError(null);
                const result = await bulkAssignPlatformInquiries({ ids: selected, staffId: assignTo, confirm: true });
                if (result.failed?.length) {
                  setBulkError(
                    `${result.failed.length} of ${selected.length} failed: ${result.failed
                      .slice(0, 3)
                      .map((f) => f.reason)
                      .join("; ")}`,
                  );
                }
                setSelected((result.failed ?? []).map((f) => f.id).filter((id): id is string => Boolean(id)));
                await load();
              }}
            >
              Confirm assign
            </button>
          </PermissionGate>
          <PermissionGate me={me ?? undefined} need="inquiries.status">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              aria-label="Set status for selected inquiries"
              className="rounded border border-white/10 bg-white/5 px-2 py-1"
            >
              <option value="">Set status…</option>
              {["TRIAGED","ASSIGNED","IN_PROGRESS","WAITING_FOR_CUSTOMER","RESOLVED","CLOSED","SPAM"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              className="px-3 py-1 rounded border border-white/10"
              onClick={async () => {
                if (!bulkStatus) return;
                if (!window.confirm(`Set ${selected.length} inquiries to ${bulkStatus}?`)) return;
                setBulkError(null);
                const result = await bulkStatusPlatformInquiries({ ids: selected, status: bulkStatus, confirm: true });
                if (result.failed?.length) {
                  setBulkError(
                    `${result.failed.length} of ${selected.length} failed: ${result.failed
                      .slice(0, 3)
                      .map((f) => f.reason)
                      .join("; ")}`,
                  );
                }
                setSelected((result.failed ?? []).map((f) => f.id).filter((id): id is string => Boolean(id)));
                await load();
              }}
            >
              Confirm status
            </button>
          </PermissionGate>
          {bulkError ? (
            <p role="alert" className="w-full text-amber-200 text-xs">
              {bulkError}
            </p>
          ) : null}
        </div>
      )}

      <div
        className="hidden lg:block overflow-x-auto border border-white/10 rounded-xl"
        tabIndex={0}
        role="region"
        aria-label="Inbox inquiries table"
      >
        <table className="w-full text-sm" data-testid="inbox-table">
          <thead className="text-left text-ink border-b border-white/10">
            <tr>
              <th className="p-3 w-8">
                <span className="sr-only">Select</span>
              </th>
              {COLUMNS.map((col) => (
                <th key={col.key} className="p-3 font-medium">
                  <button onClick={() => toggleSort(col.key)} className="hover:text-white">
                    {col.label}
                    {sort === col.key || (sort === "score" && col.key === "leadScore") ? (dir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={15} className="p-8 text-center text-ink">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={15} className="p-8 text-center text-ink">No inquiries match these filters.</td></tr>
            )}
            {items.map((row) => (
              <tr key={row.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={`Select inquiry ${row.reference}`}
                    checked={selected.includes(row.id)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, row.id] : prev.filter((id) => id !== row.id),
                      )
                    }
                  />
                </td>
                <td className="p-3">{row.unread ? <span className="font-semibold">Unread</span> : "Read"}</td>
                <td className="p-3 font-mono text-xs">{row.channel ?? "web_form"}</td>
                <td className="p-3 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="p-3">
                  <Link href={`/admin/contact/${row.id}`} className="hover:text-lime" title={row.lastMessagePreview} data-testid={`inbox-open-${row.id}`}>
                    {row.firstName}
                  </Link>
                </td>
                <td className="p-3">{row.lastName}</td>
                <td className="p-3">{row.company}</td>
                <td className="p-3">{row.jobTitle}</td>
                <td className="p-3">{row.country}</td>
                <td className="p-3">{row.useCase.join(", ")}</td>
                <td className="p-3">{row.qualificationStatus}</td>
                <td className="p-3 font-mono">{row.leadScore}</td>
                <td className="p-3">{row.assignedTo ?? "—"}</td>
                <td className="p-3">{row.status}</td>
                <td className="p-3 whitespace-nowrap">{new Date(row.lastActivityAt).toLocaleString()}</td>
                <td className="p-3">{row.slaStatus ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Inbox pagination">
        <button
          type="button"
          className="px-3 py-1 rounded border border-white/10 disabled:opacity-40"
          disabled={cursorHistory.length === 0}
          onClick={() => {
            const prev = cursorHistory[cursorHistory.length - 1] ?? "";
            setCursorHistory((h) => h.slice(0, -1));
            setCursor(prev);
          }}
        >
          Previous
        </button>
        <span className="text-ink">
          Page {cursorHistory.length + 1}
          {total ? ` · ${total} matching` : ""}
        </span>
        <button
          type="button"
          className="px-3 py-1 rounded border border-white/10 disabled:opacity-40"
          disabled={!nextCursor}
          onClick={() => {
            if (!nextCursor) return;
            setCursorHistory((h) => [...h, cursor]);
            setCursor(nextCursor);
          }}
        >
          Next
        </button>
      </nav>

      <div className="lg:hidden space-y-3">
        {items.map((row) => (
          <Link
            key={row.id}
            href={`/admin/contact/${row.id}`}
            className="block rounded-xl border border-white/10 p-4"
          >
            <div className="flex justify-between gap-3">
              <p className={`font-semibold ${row.unread ? "text-white" : "text-ink"}`}>
                {row.firstName} {row.lastName}
              </p>
              <span className="text-xs font-mono">{row.leadScore}</span>
            </div>
            <p className="text-sm text-ink mt-1">{row.company} · {row.country}</p>
            <p className="text-xs text-ink mt-2">{row.qualificationStatus} · {row.status}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
