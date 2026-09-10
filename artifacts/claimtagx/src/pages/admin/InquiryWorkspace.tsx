import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import {
  acquirePlatformRecordLock,
  addPlatformInquiryNote,
  addPlatformInquiryTag,
  assignPlatformInquiry,
  convertPlatformInquiryLead,
  forwardPlatformInquiry,
  generatePlatformInquiryMeeting,
  getPlatformContactInquiry,
  getPlatformContactPresence,
  heartbeatPlatformContactPresence,
  heartbeatPlatformRecordLock,
  listPlatformContactStaff,
  listPlatformContactTemplates,
  mergePlatformContacts,
  overridePlatformInquiryQualification,
  overridePlatformRecordLock,
  pausePlatformInquirySla,
  releasePlatformRecordLock,
  replyPlatformInquiry,
  retryPlatformContactMessage,
  resumePlatformInquirySla,
  runPlatformInquiryMacro,
  setPlatformInquiryPriority,
  setPlatformInquiryStatus,
  type CrmInquiryPriority,
  type CrmInquiryStatus,
  type CrmQualificationStatus,
} from "@workspace/api-client-react";

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
    updatedAt?: string;
    attribution: Record<string, unknown> | null;
    humanOverrideStatus: string | null;
    systemQualificationStatus: string | null;
    channel?: string;
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
    deliveryStatus?: string | null;
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
  composer?: { outbound?: boolean; disabledReason?: string | null; manualHandoff?: boolean };
  identities?: Array<{ channel: string; providerUserId: string; verificationStatus: string; displayName: string | null }>;
  inboxChannel?: string;
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
  const [conflict, setConflict] = useState<string | null>(null);
  const [lockId, setLockId] = useState<string | null>(null);
  const [lockHolder, setLockHolder] = useState<string | null>(null);
  const [presenceLabel, setPresenceLabel] = useState<string | null>(null);
  const [tagSlug, setTagSlug] = useState("");
  const [overrideLockReason, setOverrideLockReason] = useState("");
  const draftKey = `crm-draft:${params.id ?? ""}`;

  async function load() {
    const detail = await getPlatformContactInquiry(params.id!);
    setData(detail as unknown as Detail);
  }

  useEffect(() => {
    void load();
    listPlatformContactStaff().then((d) =>
      setStaff((d.staff ?? []).map((s) => ({ id: s.id, name: s.name }))),
    );
    listPlatformContactTemplates().then((d) =>
      setTemplates((d.templates ?? []).map((t) => ({ key: t.key, internalName: t.internalName }))),
    );
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setDraft(saved);
    } catch {
      /* ignore */
    }
  }, [params.id]);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, draft);
    } catch {
      /* ignore */
    }
  }, [draft, draftKey]);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    let currentLockId: string | null = null;
    const entity = { entityType: "inquiry" as const, entityId: params.id };

    async function refreshPresence() {
      try {
        const data = await getPlatformContactPresence({ entityType: "inquiry", entityId: params.id! });
        const snap = data as {
          presence?: Array<{ staffId: string; staffName?: string | null }>;
          lock?: { id?: string; staffId?: string; staffName?: string | null } | null;
        };
        if (cancelled) return;
        const names = (snap.presence ?? [])
          .map((p) => p.staffName || "Staff")
          .filter(Boolean)
          .slice(0, 4);
        setPresenceLabel(names.length ? `Viewing: ${names.join(", ")}` : null);
        if (snap.lock?.staffName) setLockHolder(snap.lock.staffName);
      } catch {
        /* ignore presence errors in UI */
      }
    }

    async function takeLock() {
      try {
        const res = await acquirePlatformRecordLock({ ...entity, intent: "edit" });
        if (cancelled) return;
        currentLockId = res.lock.id;
        setLockId(res.lock.id);
        setLockHolder(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Locked by another editor";
        if (!cancelled) setLockHolder(msg);
      }
      await refreshPresence();
    }

    void takeLock();
    const heartbeat = window.setInterval(() => {
      void refreshPresence();
      const lockIdForHeartbeat = currentLockId;
      if (!lockIdForHeartbeat) return;
      void heartbeatPlatformRecordLock(lockIdForHeartbeat).catch(() => {
        currentLockId = null;
        setLockId(null);
      });
      void heartbeatPlatformContactPresence({ ...entity, intent: "edit" }).catch(() => undefined);
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      const held = currentLockId;
      if (held) {
        void releasePlatformRecordLock(held).catch(() => undefined);
      }
    };
  }, [params.id]);

  if (!data) return <div className="p-8 text-ink">Opening inquiry…</div>;
  const q = data.qualification[0];
  const inq = data.inquiry;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="inquiry-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/contact" className="text-xs text-ink hover:text-white">← Inbox</Link>
          <h1 className="text-xl font-semibold font-mono mt-1">{inq.reference}</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-lime/15 text-lime">{inq.qualificationStatus}</span>
          <span className="px-2 py-1 rounded bg-white/10">{inq.status}</span>
        </div>
      </div>

      {(lockHolder || presenceLabel) && (
        <div
          role="status"
          aria-live="polite"
          className="text-sm rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-amber-100"
          data-testid="inquiry-presence"
        >
          {lockHolder ? <p>Edit lease: {lockHolder}</p> : null}
          {presenceLabel ? <p>{presenceLabel}</p> : null}
          {lockHolder && lockId === null ? (
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <input
                aria-label="Override lock reason"
                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs min-w-[12rem]"
                value={overrideLockReason}
                onChange={(e) => setOverrideLockReason(e.target.value)}
                placeholder="Override reason (min 5 chars)"
              />
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-white/20"
                disabled={overrideLockReason.trim().length < 5}
                onClick={async () => {
                  const list = (await getPlatformContactPresence({ entityType: "inquiry", entityId: inq.id })) as { lock?: { id?: string } | null };
                  const lockId = list.lock?.id;
                  if (!lockId) return;
                  await overridePlatformRecordLock(lockId, { reason: overrideLockReason.trim() });
                  setOverrideLockReason("");
                  setLockHolder(null);
                  const acquired = await acquirePlatformRecordLock({ entityType: "inquiry", entityId: inq.id, intent: "edit" });
                  setLockId(acquired.lock.id);
                }}
              >
                Override lock
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className="grid xl:grid-cols-[18rem_minmax(0,1fr)_20rem] gap-4">
        <aside className="space-y-4 text-sm border border-white/10 rounded-xl p-4 h-fit">
          <h2 className="text-xs uppercase tracking-wide text-ink">Contact</h2>
          <p className="font-semibold">{data.contact.firstName} {data.contact.lastName}</p>
          <p>{data.company?.name}</p>
          <p className="text-ink">{data.contact.jobTitle}</p>
          <p>{data.contact.country}</p>
          <p className="break-all">{data.contact.email}</p>
          <p className="font-mono">{data.contact.phoneE164}</p>
          <p className="text-xs text-ink pt-2">Channel: {data.inboxChannel ?? inq.channel ?? "website"}</p>
          {(data.identities ?? []).map((identity) => (
            <p key={`${identity.channel}:${identity.providerUserId}`} className="text-xs">
              {identity.channel} · {identity.displayName || identity.providerUserId} · {identity.verificationStatus}
            </p>
          ))}
          <MergeContacts />
          <h2 className="text-xs uppercase tracking-wide text-ink pt-4">Assignment</h2>
          <select
            data-testid="inquiry-assignment"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2"
            value={inq.assignedStaffId ?? ""}
            onChange={async (e) => {
              await assignPlatformInquiry(inq.id, { staffId: e.target.value || null });
              await load();
            }}
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p className="text-xs text-ink">{inq.assignedReason}</p>
          <select
            data-testid="inquiry-status"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2"
            value={inq.status}
            onChange={async (e) => {
              await setPlatformInquiryStatus(inq.id, { status: e.target.value as CrmInquiryStatus });
              await load();
            }}
          >
            {["NEW","TRIAGED","ASSIGNED","IN_PROGRESS","WAITING_FOR_CUSTOMER","WAITING_INTERNAL","RESOLVED","CLOSED","SPAM","DUPLICATE","CANCELLED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            data-testid="inquiry-priority"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2"
            value={inq.priority}
            onChange={async (e) => {
              await setPlatformInquiryPriority(inq.id, { priority: e.target.value as CrmInquiryPriority });
              await load();
            }}
          >
            {["low","normal","high","urgent"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <div className="flex flex-wrap gap-1" data-testid="inquiry-tags">
            {data.tags.map((t) => (
              <span key={t.slug} className="px-2 py-0.5 rounded-full bg-white/10 text-xs">{t.label}</span>
            ))}
            <form
              className="flex gap-1 w-full mt-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!tagSlug.trim()) return;
                await addPlatformInquiryTag(inq.id, { slug: tagSlug.trim() });
                setTagSlug("");
                await load();
              }}
            >
              <input
                data-testid="inquiry-tag-input"
                aria-label="Add tag"
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs"
                value={tagSlug}
                onChange={(e) => setTagSlug(e.target.value)}
                placeholder="tag-slug"
              />
              <button type="submit" data-testid="inquiry-tag-add" className="text-xs border border-white/20 px-2 py-1 rounded">
                Add tag
              </button>
            </form>
          </div>
        </aside>

        <section className="border border-white/10 rounded-xl p-4 min-h-[28rem] flex flex-col">
          <div className="flex-1 space-y-4 overflow-auto max-h-[55vh] pr-1" data-testid="inquiry-timeline">
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
                <p className="text-[11px] text-ink mb-1">
              {m.kind} · {m.authorType} · {m.deliveryStatus ? `${m.deliveryStatus} · ` : ""}
              {new Date(m.createdAt).toLocaleString()}
                  {m.forwardedTo ? ` · forwarded to ${m.forwardedTo}` : ""}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
                {(m.deliveryStatus === "failed" || m.deliveryStatus === "uncertain") && m.authorType === "staff" ? (
                  <button
                    type="button"
                    className="mt-2 text-xs border border-white/20 px-2 py-1 rounded"
                    data-testid={`outbound-retry-${m.id}`}
                    onClick={async () => {
                      await retryPlatformContactMessage(m.id);
                      await load();
                    }}
                  >
                    Retry / reconcile outbound
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="flex gap-2 mb-2 text-xs">
              {(["reply", "note", "forward"] as const).map((t) => (
                <button
                  key={t}
                  data-testid={`composer-tab-${t}`}
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
              id="inquiry-composer"
              aria-label={tab === "forward" ? "Forward to email" : "Message body"}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm min-h-28"
              value={tab === "forward" ? forwardTo : draft}
              onChange={(e) => (tab === "forward" ? setForwardTo(e.target.value) : setDraft(e.target.value))}
              placeholder={tab === "forward" ? "Forward to email" : "Write a message"}
            />
            {data.composer?.outbound === false ? (
              <p role="alert" className="text-xs text-amber-200 mt-2">{data.composer.disabledReason}</p>
            ) : null}
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                data-testid="inquiry-send"
                className="bg-lime text-obsidian px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
                disabled={tab === "reply" && data.composer?.outbound === false}
                onClick={async () => {
                  setConflict(null);
                  try {
                    if (tab === "reply") {
                      const latest = (await getPlatformContactInquiry(inq.id)) as unknown as Detail;
                      const templateKey = draft.startsWith("{{template:")
                        ? draft.slice(11, -2)
                        : undefined;
                      await replyPlatformInquiry(inq.id, {
                          body: templateKey ? " " : draft,
                          templateKey,
                          expectedUpdatedAt: latest.inquiry.updatedAt,
                        });
                    } else if (tab === "note") {
                      await addPlatformInquiryNote(inq.id, { body: draft });
                    } else {
                      await forwardPlatformInquiry(inq.id, { to: forwardTo, note: draft });
                    }
                    setDraft("");
                    await load();
                  } catch (err) {
                    setConflict(err instanceof Error ? err.message : "Send failed");
                  }
                }}
              >
                Send
              </button>
              {conflict ? <p className="text-xs text-red-400" role="alert">{conflict}</p> : null}
              <button
                className="border border-white/15 px-4 py-2 rounded-lg text-sm"
                onClick={async () => {
                  const r = await generatePlatformInquiryMeeting(inq.id);
                  setDraft((d) => `${d}\n${r.bookingUrl}`.trim());
                }}
              >
                Insert meeting link
              </button>
              <button
                className="border border-white/15 px-4 py-2 rounded-lg text-sm"
                onClick={async () => {
                  await runPlatformInquiryMacro(inq.id, "SEND_MEETING_REQUEST");
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
            <h2 className="text-xs uppercase tracking-wide text-ink mb-2">Qualification</h2>
            <p className="text-2xl font-semibold">{inq.qualificationScore}</p>
            <p className="text-lime text-sm">{inq.qualificationStatus}</p>
            {q && (
              <ul className="mt-3 space-y-1 text-ink">
                {q.reasons.map((r, i) => (
                  <li key={i}>
                    {typeof r.points === "number" && r.points > 0 ? "+" : ""}
                    {r.points ?? ""} {r.reason}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-ink mt-3">
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
                  await overridePlatformInquiryQualification(inq.id, {
                      status: overrideStatus as CrmQualificationStatus,
                      reason: overrideReason,
                    });
                  await load();
                }}
              >
                Override qualification
              </button>
              <button
                className="text-xs border border-white/15 px-3 py-1 rounded"
                onClick={async () => {
                  await convertPlatformInquiryLead(inq.id, { note: overrideReason || "Converted from workspace" });
                  await load();
                }}
              >
                Convert to opportunity
              </button>
            </div>
          </div>
          <div className="border border-white/10 rounded-xl p-4">
            <h2 className="text-xs uppercase tracking-wide text-ink mb-2">Requirements</h2>
            {data.answers.map((a) => (
              <p key={a.questionKey} className="mb-2">
                <span className="text-ink">{a.questionKey}:</span> {a.optionKeys.join(", ")}
                {a.freeText ? ` — ${a.freeText}` : ""}
              </p>
            ))}
          </div>
          <div className="border border-white/10 rounded-xl p-4" data-testid="inquiry-sla">
            {data.sla.map((s) => (
              <p key={s.measure}>{s.measure}: {s.status} · due {new Date(s.dueAt).toLocaleString()}</p>
            ))}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                className="text-xs border border-white/15 px-3 py-1 rounded"
                onClick={async () => {
                  await pausePlatformInquirySla(inq.id);
                  await load();
                }}
              >
                Pause SLA
              </button>
              <button
                type="button"
                className="text-xs border border-white/15 px-3 py-1 rounded"
                onClick={async () => {
                  await resumePlatformInquirySla(inq.id);
                  await load();
                }}
              >
                Resume SLA
              </button>
            </div>
            {data.meetings.map((m) => (
              <p key={m.bookingUrl} className="break-all mt-2">
                {m.bookingStatus}: {m.bookingUrl}
              </p>
            ))}
          </div>
          <div className="border border-white/10 rounded-xl p-4 max-h-64 overflow-auto">
            <h2 className="text-xs uppercase tracking-wide text-ink mb-2">Audit</h2>
            {data.audit.map((a, i) => (
              <p key={i} className="text-xs text-ink mb-1">
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

function MergeContacts() {
  const [winnerId, setWinnerId] = useState("");
  const [loserId, setLoserId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="pt-4 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await mergePlatformContacts({ winnerId, loserId });
          setMsg("Merge requested. Duplicate contact email was rewritten.");
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "Merge failed");
        }
      }}
    >
      <h2 className="text-xs uppercase tracking-wide text-ink">Merge duplicate</h2>
      <label className="block text-[11px] text-ink" htmlFor="merge-winner">
        Keep contact id
      </label>
      <input id="merge-winner" className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 font-mono text-xs" value={winnerId} onChange={(e) => setWinnerId(e.target.value)} />
      <label className="block text-[11px] text-ink" htmlFor="merge-loser">
        Absorb contact id
      </label>
      <input id="merge-loser" className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 font-mono text-xs" value={loserId} onChange={(e) => setLoserId(e.target.value)} />
      <button type="submit" className="text-xs border border-white/15 px-3 py-1 rounded">
        Merge
      </button>
      {msg ? <p className="text-xs text-ink" role="status">{msg}</p> : null}
    </form>
  );
}
