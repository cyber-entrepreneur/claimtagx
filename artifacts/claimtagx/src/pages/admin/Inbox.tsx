import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { platformFetch } from "@/lib/contactApi";

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
  unread: boolean;
  slaStatus: string | null;
  slaDueAt: string | null;
}

const COLUMNS = [
  { key: "unread", label: "State" },
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
  const [qual, setQual] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (readState !== "all") p.set("readState", readState);
    if (status) p.set("status", status);
    if (qual) p.set("qualificationStatus", qual);
    p.set("sort", sort);
    p.set("dir", dir);
    p.set("limit", "50");
    return p.toString();
  }, [search, readState, status, qual, sort, dir]);

  async function load() {
    setLoading(true);
    try {
      const data = await platformFetch<{ items: Row[]; total: number }>(
        `/api/platform/contact/inquiries?${query}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [query]);

  function toggleSort(key: string) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key === "leadScore" ? "score" : key === "lastActivityAt" ? "lastActivityAt" : "createdAt");
      setDir("asc");
    }
  }

  async function bulk(unread: boolean) {
    if (!selected.length) return;
    await platformFetch("/api/platform/contact/inquiries/bulk-read", {
      method: "POST",
      body: JSON.stringify({ ids: selected, unread }),
    });
    setSelected([]);
    await load();
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold">Contact Us Inbox</h1>
          <p className="text-sm text-slate">{total} inquiries</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, company, reference"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm w-64"
          />
          <select value={readState} onChange={(e) => setReadState(e.target.value)} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm">
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm">
            <option value="">Any status</option>
            {["NEW","TRIAGED","ASSIGNED","IN_PROGRESS","WAITING_FOR_CUSTOMER","WAITING_INTERNAL","RESOLVED","CLOSED","SPAM"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={qual} onChange={(e) => setQual(e.target.value)} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm">
            <option value="">Any qualification</option>
            {["UNASSESSED","MARKETING_QUALIFIED","SALES_QUALIFIED","HIGH_PRIORITY","DISQUALIFIED"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            className="text-sm text-slate hover:text-white"
            onClick={() => {
              setSearch("");
              setReadState("all");
              setStatus("");
              setQual("");
            }}
          >
            Clear filters
          </button>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="mb-3 flex gap-2 text-sm">
          <button onClick={() => bulk(false)} className="px-3 py-1 rounded border border-white/10">Mark read</button>
          <button onClick={() => bulk(true)} className="px-3 py-1 rounded border border-white/10">Mark unread</button>
        </div>
      )}

      <div className="hidden lg:block overflow-x-auto border border-white/10 rounded-xl">
        <table className="w-full text-sm">
          <thead className="text-left text-slate border-b border-white/10">
            <tr>
              <th className="p-3 w-8" />
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
              <tr><td colSpan={15} className="p-8 text-center text-slate">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={15} className="p-8 text-center text-slate">No inquiries match these filters.</td></tr>
            )}
            {items.map((row) => (
              <tr key={row.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(row.id)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, row.id] : prev.filter((id) => id !== row.id),
                      )
                    }
                  />
                </td>
                <td className="p-3">{row.unread ? <span className="font-semibold">Unread</span> : "Read"}</td>
                <td className="p-3 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="p-3">
                  <Link href={`/admin/contact/${row.id}`} className="hover:text-lime">{row.firstName}</Link>
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

      <div className="lg:hidden space-y-3">
        {items.map((row) => (
          <Link
            key={row.id}
            href={`/admin/contact/${row.id}`}
            className="block rounded-xl border border-white/10 p-4"
          >
            <div className="flex justify-between gap-3">
              <p className={`font-semibold ${row.unread ? "text-white" : "text-slate"}`}>
                {row.firstName} {row.lastName}
              </p>
              <span className="text-xs font-mono">{row.leadScore}</span>
            </div>
            <p className="text-sm text-slate mt-1">{row.company} · {row.country}</p>
            <p className="text-xs text-slate mt-2">{row.qualificationStatus} · {row.status}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
