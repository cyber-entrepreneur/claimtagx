import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { platformFetch } from "@/lib/contactApi";

interface Detail {
  inquiry: Record<string, unknown> & {
    id: string;
    reference: string;
    status: string;
    priority: string;
    qualificationStatus: string;
    qualificationScore: number;
    assignedReason: string | null;
    assignedStaffId: string | null;
    attribution: Record<string, unknown> | null;
    humanOverrideStatus: string | null;
    systemQualificationStatus: string | null;
  };
  contact: {
    firstName: string;
    lastName: string;
    jobTitle: string;
    email: string;
    country: string;
    phoneE164: string | null;
  };
  company: { name: string } | null;
  assignee: { name: string; email: string } | null;
  messages: Array<{
    id: string;
    kind: string;
    visibility: string;
    body: string;
    authorType: string;
    createdAt: string;
    forwardedTo?: string | null;
  }>;
  answers: Array<{ questionKey: string; optionKeys: string[]; freeText: string | null }>;
  qualification: Array<{
    score: number;
    status: string;
    reasons: Array<{ reason?: string; points?: number; matched?: boolean }>;
    source: string;
    modelVersion: number;
    createdAt: string;
  }>;
  audit: Array<{ action: string; actorType: string; createdAt: string; afterValue: Record<string, unknown> | null }>;
  sla: Array<{ measure: string; status: string; dueAt: string }>;
  meetings: Array<{ bookingUrl: string; bookingStatus: string }>;
  tags: Array<{ slug: string; label: string }>;
  executions: Array<{ status: string; trigger: string; matched: Record<string, unknown> | null }>;
}

export default function InquiryWorkspace() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"reply" | "note" | "forward">("reply");
  const [draft, setDraft] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [templates, setTemplates] = useState<Array<{ key: string; internalName: string }>>([]);
  const [overrideStatus, setOverrideStatus] = useState("SALES_QUALIFIED");
  const [overrideReason, setOverrideReason] = useState("");

  async function load() {
    const detail = await platformFetch<Detail>(`/api/platform/contact/inquiries/${params.id}`);
    setData(detail);
  }

  useEffect(() => {
    void load();
    platformFetch<{ staff: Array<{ id: string; name: string }> }>("/api/platform/contact/staff").then((d) =>
      setStaff(d.staff),
    );
    platformFetch<{ templates: Array<{ key: string; internalName: string }> }>("/api/platform/contact/templates").then(
      (d) => setTemplates(d.templates),
    );
  }, [params.id]);

  if (!data) return <div className="p-8 text-slate">Opening inquiry…</div>;
  const q = data.qualification[0];
  const inq = data.inquiry;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/contact" className="text-xs text-slate hover:text-white">← Inbox</Link>
          <h1 className="text-xl font-semibold font-mono mt-1">{inq.reference}</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-lime/15 text-lime">{inq.qualificationStatus}</span>
          <span className="px-2 py-1 rounded bg-white/10">{inq.status}</span>
        </div>
      </div>

      <div className="grid xl:grid-cols-[18rem_minmax(0,1fr)_20rem] gap-4">
        <aside className="space-y-4 text-sm border border-white/10 rounded-xl p-4 h-fit">
          <h2 className="text-xs uppercase tracking-wide text-slate">Contact</h2>
          <p className="font-semibold">{data.contact.firstName} {data.contact.lastName}</p>
          <p>{data.company?.name}</p>
          <p className="text-slate">{data.contact.jobTitle}</p>
          <p>{data.contact.country}</p>
          <p className="break-all">{data.contact.email}</p>
          <p className="font-mono">{data.contact.phoneE164}</p>
          <h2 className="text-xs uppercase tracking-wide text-slate pt-4">Assignment</h2>
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2"
            value={inq.assignedStaffId ?? ""}
            onChange={async (e) => {
              await platformFetch(`/api/platform/contact/inquiries/${inq.id}/assign`, {
                method: "POST",
                body: JSON.stringify({ staffId: e.target.value || null }),
              });
              await load();
            }}
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p className="text-xs text-slate">{inq.assignedReason}</p>
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2"
            value={inq.status}
            onChange={async (e) => {
              await platformFetch(`/api/platform/contact/inquiries/${inq.id}/status`, {
                method: "POST",
                body: JSON.stringify({ status: e.target.value }),
              });
              await load();
            }}
          >
            {["NEW","TRIAGED","ASSIGNED","IN_PROGRESS","WAITING_FOR_CUSTOMER","WAITING_INTERNAL","RESOLVED","CLOSED","SPAM","DUPLICATE","CANCELLED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2"
            value={inq.priority}
            onChange={async (e) => {
              await platformFetch(`/api/platform/contact/inquiries/${inq.id}/priority`, {
                method: "POST",
                body: JSON.stringify({ priority: e.target.value }),
              });
              await load();
            }}
          >
            {["low","normal","high","urgent"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <div className="flex flex-wrap gap-1">
            {data.tags.map((t) => (
              <span key={t.slug} className="px-2 py-0.5 rounded-full bg-white/10 text-xs">{t.label}</span>
            ))}
          </div>
        </aside>

        <section className="border border-white/10 rounded-xl p-4 min-h-[28rem] flex flex-col">
          <div className="flex-1 space-y-4 overflow-auto max-h-[55vh] pr-1">
            {data.messages.map((m) => (
              <article
                key={m.id}
                className={`rounded-xl px-4 py-3 text-sm ${
                  m.visibility === "internal"
                    ? "bg-amber-500/10 border border-amber-500/20"
                    : m.authorType === "staff" || m.authorType === "system"
                      ? "bg-white/5 ml-8"
                      : "bg-lime/5 mr-8"
                }`}
              >
                <p className="text-[11px] text-slate mb-1">
                  {m.kind} · {m.authorType} · {new Date(m.createdAt).toLocaleString()}
                  {m.forwardedTo ? ` · forwarded to ${m.forwardedTo}` : ""}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="flex gap-2 mb-2 text-xs">
              {(["reply", "note", "forward"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 rounded ${tab === t ? "bg-white text-obsidian" : "bg-white/10"}`}
                >
                  {t}
                </button>
              ))}
              <select
                className="ml-auto bg-white/5 border border-white/10 rounded px-2"
                onChange={(e) => {
                  const key = e.target.value;
                  if (key) setDraft((d) => d || `{{template:${key}}}`);
                }}
              >
                <option value="">Insert template</option>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>{t.internalName}</option>
                ))}
              </select>
            </div>
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm min-h-28"
              value={tab === "forward" ? forwardTo : draft}
              onChange={(e) => (tab === "forward" ? setForwardTo(e.target.value) : setDraft(e.target.value))}
              placeholder={tab === "forward" ? "Forward to email" : "Write a message"}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                className="bg-lime text-obsidian px-4 py-2 rounded-lg text-sm font-semibold"
                onClick={async () => {
                  if (tab === "reply") {
                    const templateKey = draft.startsWith("{{template:")
                      ? draft.slice(11, -2)
                      : undefined;
                    await platformFetch(`/api/platform/contact/inquiries/${inq.id}/reply`, {
                      method: "POST",
                      body: JSON.stringify({
                        body: templateKey ? " " : draft,
                        templateKey,
                      }),
                    });
                  } else if (tab === "note") {
                    await platformFetch(`/api/platform/contact/inquiries/${inq.id}/notes`, {
                      method: "POST",
                      body: JSON.stringify({ body: draft }),
                    });
                  } else {
                    await platformFetch(`/api/platform/contact/inquiries/${inq.id}/forward`, {
                      method: "POST",
                      body: JSON.stringify({ to: forwardTo, note: draft }),
                    });
                  }
                  setDraft("");
                  await load();
                }}
              >
                Send
              </button>
              <button
                className="border border-white/15 px-4 py-2 rounded-lg text-sm"
                onClick={async () => {
                  const r = await platformFetch<{ bookingUrl: string }>(
                    `/api/platform/contact/inquiries/${inq.id}/meeting`,
                    { method: "POST" },
                  );
                  setDraft((d) => `${d}\n${r.bookingUrl}`.trim());
                }}
              >
                Insert meeting link
              </button>
              <button
                className="border border-white/15 px-4 py-2 rounded-lg text-sm"
                onClick={async () => {
                  await platformFetch(`/api/platform/contact/inquiries/${inq.id}/macros/SEND_MEETING_REQUEST`, {
                    method: "POST",
                  });
                  await load();
                }}
              >
                Run meeting macro
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-4 text-sm">
          <div className="border border-white/10 rounded-xl p-4">
            <h2 className="text-xs uppercase tracking-wide text-slate mb-2">Qualification</h2>
            <p className="text-2xl font-semibold">{inq.qualificationScore}</p>
            <p className="text-lime text-sm">{inq.qualificationStatus}</p>
            {q && (
              <ul className="mt-3 space-y-1 text-slate">
                {q.reasons.map((r, i) => (
                  <li key={i}>
                    {typeof r.points === "number" && r.points > 0 ? "+" : ""}
                    {r.points ?? ""} {r.reason}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate mt-3">
              System: {inq.systemQualificationStatus ?? "—"}
              {inq.humanOverrideStatus ? ` · Override: ${inq.humanOverrideStatus}` : ""}
            </p>
            <div className="mt-3 space-y-2">
              <select value={overrideStatus} onChange={(e) => setOverrideStatus(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1">
                {["UNASSESSED","UNQUALIFIED","MARKETING_QUALIFIED","SALES_QUALIFIED","HIGH_PRIORITY","DISQUALIFIED"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Override reason" className="w-full bg-white/5 border border-white/10 rounded px-2 py-1" />
              <button
                className="text-xs border border-white/15 px-3 py-1 rounded"
                onClick={async () => {
                  await platformFetch(`/api/platform/contact/inquiries/${inq.id}/qualification`, {
                    method: "POST",
                    body: JSON.stringify({ status: overrideStatus, reason: overrideReason }),
                  });
                  await load();
                }}
              >
                Override qualification
              </button>
            </div>
          </div>
          <div className="border border-white/10 rounded-xl p-4">
            <h2 className="text-xs uppercase tracking-wide text-slate mb-2">Requirements</h2>
            {data.answers.map((a) => (
              <p key={a.questionKey} className="mb-2">
                <span className="text-slate">{a.questionKey}:</span> {a.optionKeys.join(", ")}
                {a.freeText ? ` — ${a.freeText}` : ""}
              </p>
            ))}
          </div>
          <div className="border border-white/10 rounded-xl p-4">
            <h2 className="text-xs uppercase tracking-wide text-slate mb-2">SLA / Meeting</h2>
            {data.sla.map((s) => (
              <p key={s.measure}>{s.measure}: {s.status} · due {new Date(s.dueAt).toLocaleString()}</p>
            ))}
            {data.meetings.map((m) => (
              <p key={m.bookingUrl} className="break-all mt-2">
                {m.bookingStatus}: {m.bookingUrl}
              </p>
            ))}
          </div>
          <div className="border border-white/10 rounded-xl p-4 max-h-64 overflow-auto">
            <h2 className="text-xs uppercase tracking-wide text-slate mb-2">Audit</h2>
            {data.audit.map((a, i) => (
              <p key={i} className="text-xs text-slate mb-1">
                {new Date(a.createdAt).toLocaleString()} · {a.action} · {a.actorType}
              </p>
            ))}
            {data.executions.map((e, i) => (
              <p key={`w${i}`} className="text-xs text-lime/80">
                Workflow {e.trigger} → {e.status}
              </p>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
