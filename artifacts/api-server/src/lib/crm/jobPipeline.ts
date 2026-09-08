import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";

export type RetryClass =
  | "deliberately_injected"
  | "expected_lease_recovery"
  | "expected_transient_provider_simulation"
  | "dependency_not_ready"
  | "contention"
  | "implementation_defect"
  | "test_harness_defect";

export type JobPipelineEvent = {
  ts: number;
  event:
    | "claimed"
    | "lease_reclaim"
    | "started"
    | "completed"
    | "failed"
    | "retry"
    | "dead"
    | "lost_ownership"
    | "duplicate_claim";
  jobId: string;
  type: string;
  workerId?: string;
  claimGeneration?: number;
  attempts?: number;
  prevStatus?: string;
  error?: string;
  retryClass?: RetryClass;
  retryDelayMs?: number;
  expected?: boolean;
  claimWaitMs?: number;
  processingMs?: number;
  commitMs?: number;
  heartbeatCount?: number;
  leaseMs?: number;
  e2eMs?: number;
  correlationId?: string | null;
  soakRunId?: string;
  concurrencyKey?: string | null;
};

const counts = {
  claimed: 0,
  leaseReclaim: 0,
  duplicateClaim: 0,
  completed: 0,
  retry: 0,
  dead: 0,
  lostOwnership: 0,
};

export const jobPipelineMetrics = {
  slotsTotal: 0,
  slotsBusy: 0,
  typeLimitHits: 0,
  keyLimitHits: 0,
  availableCapacity: 0,
  ...counts,
};

export function databasePoolMax(): number {
  const n = Number(process.env.DATABASE_POOL_MAX ?? 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function workerConcurrency(): number {
  const raw = process.env.CRM_WORKER_CONCURRENCY;
  const configured = raw == null || raw === "" ? 4 : Number(raw);
  const poolMax = databasePoolMax();
  const poolAware = Math.max(1, Math.floor((poolMax - 2) / 2));
  if (!Number.isFinite(configured) || configured <= 0) return 1;
  return Math.max(1, Math.min(Math.floor(configured), poolAware, 32));
}

const RECURRING = new Set([
  "refresh_sla",
  "enforce_retention",
  "graph_mail_subscription_renewal",
  "graph_mail_delta_sync",
  "marketing_publish_due",
]);

const TYPE_LIMITS: Record<string, number> = {
  analytics: 8,
  ai_classify: 4,
  notify_staff: 4,
  send_acknowledgment: 2,
  run_workflows: 2,
  crm_export: 1,
  connector_outbound: 2,
  refresh_sla: 1,
  enforce_retention: 1,
  graph_mail_subscription_renewal: 1,
  graph_mail_delta_sync: 1,
  marketing_publish_due: 1,
  marketing_reconcile_publish: 1,
};

export function isRecurringJobType(type: string): boolean {
  return RECURRING.has(type);
}

export function jobTypeConcurrencyLimit(type: string): number {
  const envKey = `CRM_WORKER_CONCURRENCY_${type.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const override = Number(process.env[envKey]);
  if (Number.isFinite(override) && override > 0) return override;
  return TYPE_LIMITS[type] ?? 2;
}

export function jobConcurrencyKey(job: { type: string; payload: Record<string, unknown> }): string | null {
  const p = job.payload;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  const inquiryId = str("inquiryId");
  const conversationId = str("conversationId");
  const mailboxId = str("mailboxId") ?? str("mailbox");
  const contactId = str("contactId");
  const companyId = str("companyId");
  const exportId = str("exportJobId");
  const attachmentId = str("attachmentId");
  const documentId = str("documentId") ?? str("versionId");
  if (job.type === "run_workflows" || job.type === "send_acknowledgment" || job.type === "ai_classify") {
    return inquiryId ? `inquiry:${inquiryId}` : `type:${job.type}`;
  }
  if (job.type === "notify_staff" && inquiryId) return `inquiry:${inquiryId}:notify`;
  if (job.type === "crm_export" && exportId) return `export:${exportId}`;
  if (job.type === "connector_outbound" && conversationId) return `conversation:${conversationId}`;
  if (inquiryId && (job.type.includes("inquiry") || job.type === "inbound_email")) return `inquiry:${inquiryId}`;
  if (conversationId) return `conversation:${conversationId}`;
  if (mailboxId) return `mailbox:${mailboxId}`;
  if (contactId) return `contact:${contactId}`;
  if (companyId) return `company:${companyId}`;
  if (attachmentId) return `attachment:${attachmentId}`;
  if (documentId) return `cms:${documentId}`;
  if (RECURRING.has(job.type)) return `recurring:${job.type}`;
  return null;
}

export function classifyJobFailure(error: string, type: string): { retryClass: RetryClass; expected: boolean; immediateDead: boolean } {
  const msg = error.toLowerCase();
  if (type.startsWith("soak_poison") || /intentional poison/.test(msg)) {
    return { retryClass: "deliberately_injected", expected: true, immediateDead: true };
  }
  if (msg.includes("injected transient soak") || msg.includes("injected failure")) {
    return { retryClass: "deliberately_injected", expected: true, immediateDead: false };
  }
  if (msg.includes("unknown crm job type")) {
    return { retryClass: "implementation_defect", expected: false, immediateDead: true };
  }
  if (msg.includes("lost job ownership") || msg.includes("stale") || msg.includes("could not obtain")) {
    return { retryClass: "contention", expected: false, immediateDead: false };
  }
  if (msg.includes("provider timeout") || msg.includes("econnreset") || msg.includes("provider 429") || msg.includes("provider 500")) {
    return { retryClass: "expected_transient_provider_simulation", expected: true, immediateDead: false };
  }
  if (msg.includes("conversation not found") || msg.includes("is not published") || msg.includes("not found")) {
    return { retryClass: "dependency_not_ready", expected: false, immediateDead: false };
  }
  return { retryClass: "implementation_defect", expected: false, immediateDead: false };
}

export function recordJobPipelineEvent(ev: JobPipelineEvent): void {
  if (ev.event === "claimed") jobPipelineMetrics.claimed += 1;
  if (ev.event === "lease_reclaim") jobPipelineMetrics.leaseReclaim += 1;
  if (ev.event === "duplicate_claim") jobPipelineMetrics.duplicateClaim += 1;
  if (ev.event === "completed") jobPipelineMetrics.completed += 1;
  if (ev.event === "retry") jobPipelineMetrics.retry += 1;
  if (ev.event === "dead") jobPipelineMetrics.dead += 1;
  if (ev.event === "lost_ownership") jobPipelineMetrics.lostOwnership += 1;
  const path = process.env.CRM_JOB_PIPELINE_LOG;
  if (!path || path === "off" || path === "false") return;
  const safe = {
    ...ev,
    error: ev.error ? String(ev.error).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]") : undefined,
    correlationId: ev.correlationId
      ? `c:${createHash("sha256").update(String(ev.correlationId)).digest("hex").slice(0, 12)}`
      : null,
  };
  try {
    appendFileSync(path, `${JSON.stringify(safe)}\n`);
  } catch {
    /* log failures must not fail job processing */
  }
}

export function pipelineSaturation(busy: number, total: number): void {
  jobPipelineMetrics.slotsBusy = busy;
  jobPipelineMetrics.slotsTotal = total;
  jobPipelineMetrics.availableCapacity = Math.max(0, total - busy);
}
