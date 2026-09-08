/**
 * Clean-DB multi-API/worker soak with workload-specific queue drain.
 *
 * Requires DATABASE_URL → claimtagx_crm_soak on 127.0.0.1:55432 (empty historical rows).
 * Not a production SLO claim. HTTP latency alone cannot PASS.
 *
 * From artifacts/api-server:
 *   node --import tsx scripts/multi-api-soak-drain.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db, pool, crmJobsTable } from "@workspace/db";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("127.0.0.1:55432") || !url.includes("claimtagx_crm_soak")) {
  console.error("Refusing: DATABASE_URL must target claimtagx_crm_soak on 127.0.0.1:55432");
  process.exit(2);
}
// Parent shell may set CRM_SKIP_RUNTIME_SEED=true for other workflows; soak APIs must seed if needed.
process.env.CRM_SKIP_RUNTIME_SEED = "false";
/** Short leases so killed-worker backlog is reclaimable within local drain timeout. */
const jobLeaseMs = Number(process.env.CRM_JOB_LEASE_MS ?? 8_000);

const RECURRING_TYPES = [
  "refresh_sla",
  "enforce_retention",
  "graph_mail_subscription_renewal",
  "graph_mail_delta_sync",
  "marketing_publish_due",
] as const;

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiDir = join(root, "artifacts/api-server");
const tmpDir = join(root, "tmp");
const node = process.execPath;
const matrixSpec = process.env.MATRIX ?? "1x1,2x2,4x2,4x4";
const drainTimeoutMs = Number(process.env.SOAK_DRAIN_TIMEOUT_MS ?? 240_000);
const basePort = Number(process.env.SOAK_BASE_PORT ?? 18300);
const masterRunId = process.env.SOAK_RUN_ID ?? `soak-${Date.now()}-${randomUUID().slice(0, 8)}`;

mkdirSync(tmpDir, { recursive: true });

type ProcHandle = { child: ChildProcess; kind: "api" | "worker"; id: string; port?: number };

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

/** Local engineering objectives — not production SLOs. */
const CAPACITY_OBJECTIVES = {
  claim_latency_p95_ms: 500,
  processing_latency_p95_ms: { analytics: 400, ai_classify: 800, notify_staff: 800, run_workflows: 4000, crm_export: 8000, default: 2000 },
  min_jobs_per_worker_per_sec_steady: 2,
  min_jobs_per_worker_per_sec_burst: 1.5,
  max_unexplained_retry_fraction_steady: 0,
  max_unexplained_retry_fraction_burst: 0.02,
  oldest_pending_age_ms_after_drain: 0,
  worker_loss_recovery_lease_plus_ms: 90_000,
};

type PipelineEvent = {
  event: string;
  jobId: string;
  type: string;
  workerId?: string;
  claimGeneration?: number;
  attempts?: number;
  error?: string;
  retryClass?: string;
  retryDelayMs?: number;
  expected?: boolean;
  claimWaitMs?: number;
  processingMs?: number;
  commitMs?: number;
  heartbeatCount?: number;
  e2eMs?: number;
  correlationId?: string | null;
  soakRunId?: string;
};

function readPipelineEvents(label: string): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  for (const name of readdirSync(tmpDir)) {
    if (!name.startsWith(`soak-drain-${label}-`) || !name.endsWith(".pipeline.jsonl")) continue;
    const text = readFileSync(join(tmpDir, name), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as PipelineEvent);
      } catch {
        /* ignore */
      }
    }
  }
  return events;
}

function belongsToRun(ev: PipelineEvent, runId: string): boolean {
  return (
    ev.soakRunId === runId ||
    (typeof ev.correlationId === "string" && ev.correlationId.startsWith(runId))
  );
}

function summarizeJobTypes(events: PipelineEvent[], runId: string, workers: number, drainMs: number) {
  const scoped = events.filter((e) => belongsToRun(e, runId));
  const types = new Map<
    string,
    {
      created: number;
      claimed: number;
      completed: number;
      failed: number;
      retry: number;
      dead: number;
      duplicate_claim: number;
      lease_reclaim: number;
      claimWait: number[];
      processing: number[];
      commit: number[];
      e2e: number[];
      heartbeats: number;
      backoff: number[];
      lost_ownership: number;
    }
  >();
  const seenClaim = new Set<string>();
  function row(type: string) {
    if (!types.has(type)) {
      types.set(type, {
        created: 0,
        claimed: 0,
        completed: 0,
        failed: 0,
        retry: 0,
        dead: 0,
        duplicate_claim: 0,
        lease_reclaim: 0,
        claimWait: [],
        processing: [],
        commit: [],
        e2e: [],
        heartbeats: 0,
        backoff: [],
        lost_ownership: 0,
      });
    }
    return types.get(type)!;
  }
  for (const ev of scoped) {
    const r = row(ev.type);
    if (ev.event === "claimed") {
      r.claimed += 1;
      if (!seenClaim.has(ev.jobId)) {
        seenClaim.add(ev.jobId);
        r.created += 1;
      }
    }
    if (ev.event === "completed") {
      r.completed += 1;
      if (ev.claimWaitMs != null) r.claimWait.push(ev.claimWaitMs);
      if (ev.processingMs != null) r.processing.push(ev.processingMs);
      if (ev.commitMs != null) r.commit.push(ev.commitMs);
      if (ev.e2eMs != null) r.e2e.push(ev.e2eMs);
      r.heartbeats += ev.heartbeatCount ?? 0;
    }
    if (ev.event === "retry") {
      r.retry += 1;
      r.failed += 1;
      if (ev.retryDelayMs != null) r.backoff.push(ev.retryDelayMs);
    }
    if (ev.event === "dead") r.dead += 1;
    if (ev.event === "duplicate_claim") r.duplicate_claim += 1;
    if (ev.event === "lease_reclaim") r.lease_reclaim += 1;
    if (ev.event === "lost_ownership") r.lost_ownership += 1;
  }
  const table = [...types.entries()].map(([type, r]) => {
    const e2eSorted = [...r.e2e].sort((a, b) => a - b);
    const procSorted = [...r.processing].sort((a, b) => a - b);
    const claimSorted = [...r.claimWait].sort((a, b) => a - b);
    const commitSorted = [...r.commit].sort((a, b) => a - b);
    const drainSec = Math.max(0.001, drainMs / 1000);
    return {
      type,
      created: r.created,
      claimed: r.claimed,
      completed: r.completed,
      failed: r.failed,
      retry: r.retry,
      dead: r.dead,
      duplicate_claim: r.duplicate_claim,
      lease_reclaim: r.lease_reclaim,
      lost_ownership: r.lost_ownership,
      claim_wait_p50_ms: pct(claimSorted, 0.5),
      claim_wait_p95_ms: pct(claimSorted, 0.95),
      processing_p50_ms: pct(procSorted, 0.5),
      processing_p95_ms: pct(procSorted, 0.95),
      commit_p50_ms: pct(commitSorted, 0.5),
      e2e_p50_ms: pct(e2eSorted, 0.5),
      e2e_p95_ms: pct(e2eSorted, 0.95),
      e2e_p99_ms: pct(e2eSorted, 0.99),
      heartbeat_count: r.heartbeats,
      backoff_p50_ms: pct([...r.backoff].sort((a, b) => a - b), 0.5),
      throughput_per_worker_jps: Number((r.completed / drainSec / Math.max(1, workers)).toFixed(3)),
    };
  });
  table.sort((a, b) => b.completed - a.completed);
  return table;
}

function classifyRetryTable(events: PipelineEvent[], runId: string) {
  return events
    .filter((e) => belongsToRun(e, runId) && (e.event === "retry" || e.event === "dead" || e.event === "lease_reclaim"))
    .map((e) => ({
      jobId: e.jobId,
      type: e.type,
      attempt: e.attempts ?? null,
      event: e.event,
      error: e.error ?? null,
      retry_class: e.retryClass ?? (e.event === "lease_reclaim" ? "expected_lease_recovery" : "unclassified"),
      retry_delay_ms: e.retryDelayMs ?? null,
      worker: e.workerId ?? null,
      generation: e.claimGeneration ?? null,
      expected: e.expected ?? e.event === "lease_reclaim",
    }));
}

function unexplainedRetries(retries: ReturnType<typeof classifyRetryTable>): number {
  return retries.filter((r) => r.event === "retry" && !r.expected).length;
}

function capacityVerdict(opts: {
  phase: string;
  workers: number;
  drainMs: number;
  completed: number;
  unexplainedRetry: number;
  completedTotal: number;
}): { pass: boolean; reason: string | null; observed_jps_per_worker: number } {
  const jps = opts.completed / Math.max(0.001, opts.drainMs / 1000) / Math.max(1, opts.workers);
  if (opts.phase === "steady_below_capacity") {
    if (opts.unexplainedRetry > 0) {
      return { pass: false, reason: `unexplained_retries=${opts.unexplainedRetry}`, observed_jps_per_worker: jps };
    }
    if (opts.drainMs > 8000 && jps < CAPACITY_OBJECTIVES.min_jobs_per_worker_per_sec_steady) {
      return {
        pass: false,
        reason: `steady_throughput ${jps.toFixed(3)} < ${CAPACITY_OBJECTIVES.min_jobs_per_worker_per_sec_steady} jobs/s/worker`,
        observed_jps_per_worker: jps,
      };
    }
  }
  if (opts.phase === "burst_then_drain") {
    const frac = opts.unexplainedRetry / Math.max(1, opts.completedTotal);
    if (frac > CAPACITY_OBJECTIVES.max_unexplained_retry_fraction_burst) {
      return { pass: false, reason: `unexplained_retry_fraction=${frac.toFixed(4)}`, observed_jps_per_worker: jps };
    }
    if (opts.drainMs > 12000 && jps < CAPACITY_OBJECTIVES.min_jobs_per_worker_per_sec_burst) {
      return {
        pass: false,
        reason: `burst_throughput ${jps.toFixed(3)} < ${CAPACITY_OBJECTIVES.min_jobs_per_worker_per_sec_burst} jobs/s/worker`,
        observed_jps_per_worker: jps,
      };
    }
  }
  return { pass: true, reason: null, observed_jps_per_worker: Number(jps.toFixed(3)) };
}

function startProc(kind: "api" | "worker", id: string, args: string[], env: Record<string, string>): ProcHandle {
  const child = spawn(node, args, {
    cwd: apiDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let out = "";
  let err = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (err += d));
  child.on("exit", () => {
    try {
      writeFileSync(join(tmpDir, `${id}.out.log`), out);
      writeFileSync(join(tmpDir, `${id}.err.log`), err);
    } catch {
      /* ignore */
    }
  });
  return { child, kind, id, port: env.PORT ? Number(env.PORT) : undefined };
}

async function waitLive(port: number, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/livez`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  return false;
}

async function stopAll(procs: ProcHandle[]) {
  for (const p of procs) {
    try {
      p.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await sleep(500);
  for (const p of procs) {
    try {
      if (!p.child.killed) p.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  await sleep(200);
}

async function assertCleanBaseline() {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM crm_jobs WHERE status='pending') AS pending,
      (SELECT COUNT(*)::int FROM crm_jobs WHERE status='running') AS running,
      (SELECT COUNT(*)::int FROM crm_jobs WHERE status='dead') AS dead,
      (SELECT COUNT(*)::int FROM crm_jobs WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW()) AS active_leases,
      (SELECT COUNT(*)::int FROM crm_job_effects WHERE status='uncertain') AS uncertain_effects,
      (SELECT COUNT(*)::int FROM crm_export_jobs WHERE status IN ('pending','running')) AS incomplete_exports,
      (SELECT COUNT(*)::int FROM crm_marketing_versions WHERE status IN ('scheduled','publishing')) AS incomplete_publications,
      (SELECT COUNT(*)::int FROM crm_attachment_uploads WHERE status IN ('uploading','assembling','scanning','completing')) AS incomplete_uploads,
      (SELECT COUNT(*)::int FROM crm_inquiries) AS inquiries,
      (SELECT COUNT(*)::int FROM crm_jobs) AS jobs_total
  `);
  const b = r.rows[0] as Record<string, number>;
  const failures: string[] = [];
  for (const k of [
    "pending",
    "running",
    "dead",
    "active_leases",
    "uncertain_effects",
    "incomplete_exports",
    "incomplete_publications",
    "incomplete_uploads",
    "inquiries",
    "jobs_total",
  ]) {
    if (Number(b[k] ?? -1) !== 0) failures.push(`${k}=${b[k]}`);
  }
  if (failures.length) {
    throw new Error(`Soak baseline not clean: ${failures.join(", ")}`);
  }
  return b;
}

async function loadOwnerStaffId(): Promise<string> {
  const r = await pool.query(
    `SELECT id FROM crm_staff WHERE status='active' AND role IN ('owner','administrator') ORDER BY created_at LIMIT 1`,
  );
  if (!r.rows[0]?.id) throw new Error("No owner/administrator staff in soak DB — run seed-soak-db.mts");
  return String(r.rows[0].id);
}

/** Workload jobs: correlation_id starts with runId OR payload.soakRunId = runId */
async function workloadJobStats(runId: string) {
  const byType = await pool.query(
    `
    SELECT type, status, COUNT(*)::int AS n
    FROM crm_jobs
    WHERE correlation_id LIKE $1 OR payload->>'soakRunId' = $2
    GROUP BY type, status
    ORDER BY type, status
    `,
    [`${runId}%`, runId],
  );
  const totals = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status='pending')::int AS pending,
      COUNT(*) FILTER (WHERE status='running')::int AS running,
      COUNT(*) FILTER (WHERE status='completed')::int AS completed,
      COUNT(*) FILTER (WHERE status='dead')::int AS dead,
      COUNT(*) FILTER (WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW())::int AS active_leases,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(run_at) FILTER (WHERE status='pending'))) * 1000, 0)::int AS oldest_pending_age_ms,
      COUNT(*) FILTER (WHERE attempts > 1 AND status IN ('pending','running','completed','dead'))::int AS retried
    FROM crm_jobs
    WHERE correlation_id LIKE $1 OR payload->>'soakRunId' = $2
    `,
    [`${runId}%`, runId],
  );
  const effects = await pool.query(
    `
    SELECT status, COUNT(*)::int AS n
    FROM crm_job_effects
    WHERE correlation_id LIKE $1 OR correlation_id = $2
    GROUP BY status
    `,
    [`${runId}%`, runId],
  );
  const exports = await pool.query(
    `
    SELECT e.status, COUNT(*)::int AS n
    FROM crm_export_jobs e
    JOIN crm_jobs j ON j.type='crm_export' AND j.correlation_id = e.id::text
    WHERE j.correlation_id LIKE $1 OR j.payload->>'soakRunId' = $2 OR e.id::text = ANY(
      SELECT correlation_id FROM crm_jobs WHERE type='crm_export' AND (correlation_id LIKE $1 OR payload->>'soakRunId'=$2)
    )
    GROUP BY e.status
    `,
    [`${runId}%`, runId],
  );
  // Simpler export join: exports created during run have crm_export jobs with soakRunId in payload if we set it;
  // exportJobs uses correlationId=export id. Track via jobs payload.
  const exports2 = await pool.query(
    `
    SELECT e.status, COUNT(*)::int AS n
    FROM crm_jobs j
    JOIN crm_export_jobs e ON e.id = (j.payload->>'exportJobId')::uuid
    WHERE j.type='crm_export' AND (j.correlation_id LIKE $1 OR j.payload->>'soakRunId' = $2 OR j.correlation_id = e.id::text)
      AND EXISTS (
        SELECT 1 FROM crm_jobs w
        WHERE (w.correlation_id LIKE $1 OR w.payload->>'soakRunId'=$2)
          AND (
            w.id = j.id
            OR (w.type='crm_export' AND w.payload->>'exportJobId' = j.payload->>'exportJobId')
          )
      )
    GROUP BY e.status
    `,
    [`${runId}%`, runId],
  );
  void exports;
  const recurring = await pool.query(
    `
    SELECT type, status, COUNT(*)::int AS n
    FROM crm_jobs
    WHERE type = ANY($1::text[])
    GROUP BY type, status
    `,
    [RECURRING_TYPES as unknown as string[]],
  );
  return {
    byType: byType.rows as Array<{ type: string; status: string; n: number }>,
    totals: totals.rows[0] as {
      pending: number;
      running: number;
      completed: number;
      dead: number;
      active_leases: number;
      oldest_pending_age_ms: number;
      retried: number;
    },
    effects: effects.rows as Array<{ status: string; n: number }>,
    exports: exports2.rows as Array<{ status: string; n: number }>,
    recurring: recurring.rows as Array<{ type: string; status: string; n: number }>,
  };
}

async function drainWorkload(
  runId: string,
  opts: { timeoutMs: number; expectedDeadTypes?: string[]; pollMs?: number },
) {
  const t0 = Date.now();
  const series: Array<{ t_ms: number; pending: number; running: number; oldest_ms: number }> = [];
  let last = await workloadJobStats(runId);
  series.push({
    t_ms: 0,
    pending: last.totals.pending,
    running: last.totals.running,
    oldest_ms: last.totals.oldest_pending_age_ms,
  });
  while (Date.now() - t0 < opts.timeoutMs) {
    if (last.totals.pending === 0 && last.totals.running === 0 && last.totals.active_leases === 0) {
      break;
    }
    await sleep(opts.pollMs ?? 500);
    last = await workloadJobStats(runId);
    series.push({
      t_ms: Date.now() - t0,
      pending: last.totals.pending,
      running: last.totals.running,
      oldest_ms: last.totals.oldest_pending_age_ms,
    });
  }
  const drain_ms = Date.now() - t0;
  const unexpectedDead = last.byType.filter(
    (r) => r.status === "dead" && !(opts.expectedDeadTypes ?? []).includes(r.type),
  );
  const uncertain = last.effects.filter((e) => e.status === "uncertain").reduce((a, b) => a + b.n, 0);
  const incompleteExports = last.exports
    .filter((e) => e.status === "pending" || e.status === "running")
    .reduce((a, b) => a + b.n, 0);
  const pass =
    last.totals.pending === 0 &&
    last.totals.running === 0 &&
    last.totals.active_leases === 0 &&
    unexpectedDead.length === 0 &&
    uncertain === 0 &&
    incompleteExports === 0;
  const failReason = pass
    ? null
    : [
        last.totals.pending ? `pending=${last.totals.pending}` : null,
        last.totals.running ? `running=${last.totals.running}` : null,
        last.totals.active_leases ? `leases=${last.totals.active_leases}` : null,
        unexpectedDead.length ? `unexpected_dead=${JSON.stringify(unexpectedDead)}` : null,
        uncertain ? `uncertain_effects=${uncertain}` : null,
        incompleteExports ? `incomplete_exports=${incompleteExports}` : null,
        drain_ms >= opts.timeoutMs ? `drain_timeout=${opts.timeoutMs}` : null,
      ]
        .filter(Boolean)
        .join("; ");
  return { pass, failReason, drain_ms, series, final: last };
}

function staffHeaders(staff: string): HeadersInit {
  return { "content-type": "application/json", "x-crm-test-staff-id": staff };
}

function contactBody(runId: string, label: string, n: number) {
  return {
    inquiryType: "general",
    firstName: "Soak",
    lastName: `User${n}`,
    email: `soak.${runId.slice(0, 12)}.${label}.${n}.${Date.now()}@example.com`,
    jobTitle: "Engineer",
    companyName: `Soak Co ${label}`,
    country: "US",
    phoneRaw: "+14155552671",
    message: `Synthetic soak message run=${runId} cell=${label} n=${n}.`,
    consentMarketing: false,
    consentPrivacy: true,
    termsAccepted: true,
    termsVersion: "2026-04-20",
    privacyPolicyVersion: "2026-04-20",
    honeypot: "",
    useCaseKeys: [],
    answers: {},
    idempotencyKey: randomUUID(),
  };
}

async function timed(fn: () => Promise<Response>) {
  const t0 = Date.now();
  let status = 0;
  let err = "";
  let body: unknown = null;
  try {
    const res = await fn();
    status = res.status;
    const text = await res.text().catch(() => "");
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 200);
    }
    if (!res.ok && status !== 429) err = `${status}:${String(text).slice(0, 160)}`;
  } catch (e) {
    status = 0;
    err = String(e);
  }
  return { ms: Date.now() - t0, status, err, body };
}

type HttpProfile = {
  name: string;
  ok: number;
  err: number;
  limited: number;
  wall_ms: number;
  throughput_rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  error_rate: number;
  sampleErr: string;
  arrival_rps: number;
};

async function runHttpProfile(
  name: string,
  ports: number[],
  total: number,
  concurrency: number,
  workerFn: (port: number, n: number) => Promise<{ ms: number; status: number; err: string }>,
): Promise<HttpProfile> {
  const latencies: number[] = [];
  let ok = 0,
    err = 0,
    limited = 0;
  let i = 0;
  let sampleErr = "";
  async function loop() {
    while (i < total) {
      const n = i++;
      const port = ports[n % ports.length]!;
      const r = await workerFn(port, n);
      latencies.push(r.ms);
      if (r.status === 429) limited++;
      else if (r.status >= 200 && r.status < 300) ok++;
      else {
        err++;
        if (!sampleErr && r.err) sampleErr = r.err;
      }
    }
  }
  const wall0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => loop()));
  latencies.sort((a, b) => a - b);
  const wall = Date.now() - wall0;
  return {
    name,
    ok,
    err,
    limited,
    wall_ms: wall,
    throughput_rps: Number(((ok + limited) / Math.max(0.001, wall / 1000)).toFixed(2)),
    arrival_rps: Number((total / Math.max(0.001, wall / 1000)).toFixed(2)),
    p50: pct(latencies, 0.5),
    p95: pct(latencies, 0.95),
    p99: pct(latencies, 0.99),
    max: latencies[latencies.length - 1] ?? 0,
    error_rate: Number((err / Math.max(1, ok + err + limited)).toFixed(4)),
    sampleErr,
  };
}

async function spawnFleet(apis: number, workers: number, label: string): Promise<{
  procs: ProcHandle[];
  ports: number[];
}> {
  const procs: ProcHandle[] = [];
  const ports: number[] = [];
  for (let w = 0; w < workers; w++) {
    const id = `soak-drain-${label}-worker${w}`;
    procs.push(
      startProc("worker", id, ["dist/worker.mjs"], {
        DATABASE_URL: url,
        CRM_EMBED_WORKER: "false",
        CRM_ALLOW_TEST_JOBS: "true",
        CRM_GRAPH_SIMULATOR: "true",
        CRM_EMAIL_SIMULATOR: "true",
        CRM_SKIP_RUNTIME_SEED: "false",
        CRM_JOB_LEASE_MS: String(jobLeaseMs),
        DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX ?? "12",
        CRM_WORKER_CONCURRENCY: process.env.CRM_WORKER_CONCURRENCY ?? "4",
        CRM_JOB_PIPELINE_LOG: join(tmpDir, `${id}.pipeline.jsonl`),
        WORKER_ID: `${masterRunId}-${label}-w${w}`,
        CRM_WORKER_POLL_MS: "400",
      }),
    );
  }
  for (let a = 0; a < apis; a++) {
    const port = basePort + a;
    ports.push(port);
    const id = `soak-drain-${label}-api${a}`;
    procs.push(
      startProc("api", id, ["dist/index.mjs"], {
        DATABASE_URL: url,
        PORT: String(port),
        LISTEN_HOST: "127.0.0.1",
        CRM_EMBED_WORKER: "false",
        CRM_SUBMIT_TIMING: "1",
        CRM_PUBLIC_SUBMIT_RATE_MAX: "10000",
        CRM_PUBLIC_EMAIL_SUBMIT_RATE_MAX: "10000",
        CRM_ADMIN_RATE_MAX: "10000",
        CRM_ALLOW_TEST_JOBS: "true",
        CRM_HTTP_TEST_AUTH: "true",
        CRM_GRAPH_SIMULATOR: "true",
        CRM_EMAIL_SIMULATOR: "true",
        CRM_SKIP_RUNTIME_SEED: "false",
        CRM_JOB_LEASE_MS: String(jobLeaseMs),
        DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX ?? "12",
        PLATFORM_STAFF_SESSION_SECRET: "local-soak-session-secret-not-for-production",
        NODE_ENV: "development",
      }),
    );
  }
  for (const port of ports) {
    if (!(await waitLive(port))) {
      await stopAll(procs);
      throw new Error(`API ${port} not live`);
    }
  }
  return { procs, ports };
}

async function runCell(apis: number, workers: number) {
  const label = `${apis}x${workers}`;
  const runId = `${masterRunId}:${label}`;
  const capacity = apis * workers;
  const drainMs = Math.min(360_000, drainTimeoutMs + capacity * 20_000);
  const steadyN = Math.max(6, capacity * 3);
  const burstN = Math.max(8, capacity * 6);
  const preKillN = Math.max(6, capacity * 4);
  const staffId = await loadOwnerStaffId();
  const { procs, ports } = await spawnFleet(apis, workers, label);
  const inventory = procs.map((p) => ({ id: p.id, kind: p.kind, pid: p.child.pid, port: p.port }));
  const profiles: HttpProfile[] = [];
  const phases: Array<Record<string, unknown>> = [];
  let recovery_ms: number | null = null;
  let cellPass = true;
  let cellFailReason: string | null = null;

  try {
    // --- Phase 1: steady below capacity ---
    const gen1Start = Date.now();
    const steadyNLocal = steadyN;
    const steady = await runHttpProfile("steady_contact", ports, steadyNLocal, Math.min(3, apis * 2), (port, n) => {
      const corr = `${runId}:steady:${n}:${randomUUID()}`;
      return timed(() =>
        fetch(`http://127.0.0.1:${port}/api/contact/inquiries`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-request-id": corr },
          body: JSON.stringify(contactBody(runId, `${label}-steady`, n)),
        }),
      );
    });
    profiles.push(steady);
    const gen1_ms = Date.now() - gen1Start;
    const drain1 = await drainWorkload(runId, { timeoutMs: drainMs });
    const pipe1 = readPipelineEvents(label);
    const retries1 = classifyRetryTable(pipe1, runId);
    const cap1 = capacityVerdict({
      phase: "steady_below_capacity",
      workers,
      drainMs: drain1.drain_ms,
      completed: drain1.final.totals.completed,
      unexplainedRetry: unexplainedRetries(retries1),
      completedTotal: drain1.final.totals.completed,
    });
    phases.push({
      name: "steady_below_capacity",
      generation_ms: gen1_ms,
      http: steady,
      drain: { pass: drain1.pass, drain_ms: drain1.drain_ms, failReason: drain1.failReason, totals: drain1.final.totals, series: drain1.series },
      job_types: summarizeJobTypes(pipe1, runId, workers, drain1.drain_ms),
      retries: retries1,
      capacity: cap1,
    });
    if (!drain1.pass) {
      cellPass = false;
      cellFailReason = `steady: ${drain1.failReason}`;
    } else if (!cap1.pass) {
      cellPass = false;
      cellFailReason = `steady_capacity: ${cap1.reason}`;
    }

    // --- Phase 2: burst above capacity then drain ---
    const gen2Start = Date.now();
    const burstNLocal = burstN;
    const burst = await runHttpProfile("burst_contact", ports, burstNLocal, Math.min(16, apis * 8), (port, n) => {
      const corr = `${runId}:burst:${n}:${randomUUID()}`;
      return timed(() =>
        fetch(`http://127.0.0.1:${port}/api/contact/inquiries`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-request-id": corr },
          body: JSON.stringify(contactBody(runId, `${label}-burst`, n)),
        }),
      );
    });
    profiles.push(burst);
    // Mid-burst analytics claim jobs tagged with soakRunId
    for (let j = 0; j < 15; j++) {
      await db.insert(crmJobsTable).values({
        type: "analytics",
        payload: { event: "soak_claim", n: j, soakRunId: runId },
        status: "pending",
        runAt: new Date(),
        correlationId: `${runId}:analytics:${j}`,
        idempotencyKey: `${runId}:analytics:${j}:${randomUUID()}`,
      });
    }
    // Export enqueue (correlation = export id; stamp soak via tracking after)
    const exportProfile = await runHttpProfile("export_enqueue", ports, 4, 2, async (port, n) => {
      const r = await timed(() =>
        fetch(`http://127.0.0.1:${port}/api/platform/contact/exports`, {
          method: "POST",
          headers: staffHeaders(staffId),
          body: JSON.stringify({ columns: ["reference", "status"], filters: { inquiryType: "general" } }),
        }),
      );
      const exportId = (r.body as { id?: string } | null)?.id;
      if (exportId) {
        await pool.query(
          `UPDATE crm_jobs SET payload = payload || $2::jsonb, correlation_id = COALESCE(correlation_id, $1)
           WHERE type='crm_export' AND payload->>'exportJobId' = $1`,
          [exportId, JSON.stringify({ soakRunId: runId })],
        );
      }
      return r;
    });
    profiles.push(exportProfile);
    const gen2_ms = Date.now() - gen2Start;
    const midStats = await workloadJobStats(runId);
    const drain2 = await drainWorkload(runId, { timeoutMs: drainMs });
    const pipe2 = readPipelineEvents(label);
    const retries2 = classifyRetryTable(pipe2, runId);
    const cap2 = capacityVerdict({
      phase: "burst_then_drain",
      workers,
      drainMs: drain2.drain_ms,
      completed: drain2.final.totals.completed,
      unexplainedRetry: unexplainedRetries(retries2),
      completedTotal: drain2.final.totals.completed,
    });
    phases.push({
      name: "burst_then_drain",
      generation_ms: gen2_ms,
      http: [burst, exportProfile],
      mid_workload: midStats.totals,
      mid_by_type: midStats.byType,
      drain: { pass: drain2.pass, drain_ms: drain2.drain_ms, failReason: drain2.failReason, totals: drain2.final.totals, series: drain2.series },
      job_types: summarizeJobTypes(pipe2, runId, workers, drain2.drain_ms),
      retries: retries2,
      capacity: cap2,
      rates: {
        contact_arrival_rps: burst.arrival_rps,
        contact_ok_rps: burst.throughput_rps,
        jobs_completed: drain2.final.totals.completed,
        processing_hint_rps:
          drain2.drain_ms > 0
            ? Number(((midStats.totals.pending + midStats.totals.running) / (drain2.drain_ms / 1000)).toFixed(2))
            : null,
        jobs_per_worker_per_sec: cap2.observed_jps_per_worker,
      },
    });
    if (!drain2.pass) {
      cellPass = false;
      cellFailReason = cellFailReason ?? `burst: ${drain2.failReason}`;
    } else if (!cap2.pass) {
      cellPass = false;
      cellFailReason = cellFailReason ?? `burst_capacity: ${cap2.reason}`;
    }

    // --- Phase 3: admin read volume (no new heavy jobs) ---
    profiles.push(
      await runHttpProfile("admin_inbox_keyset", ports, 30, Math.min(8, apis * 3), (port) =>
        timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/inquiries?limit=25&sort=createdAt&dir=desc`, {
            headers: staffHeaders(staffId),
          }),
        ),
      ),
    );
    profiles.push(
      await runHttpProfile("advanced_search", ports, 20, Math.min(6, apis * 2), (port, n) =>
        timed(() =>
          fetch(
            `http://127.0.0.1:${port}/api/platform/contact/inquiries?search=Soak&inquiryType=general&limit=20&offset=${n % 5}`,
            { headers: staffHeaders(staffId) },
          ),
        ),
      ),
    );
    profiles.push(
      await runHttpProfile("saved_views_list", ports, 15, 4, (port) =>
        timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/saved-views`, { headers: staffHeaders(staffId) }),
        ),
      ),
    );
    profiles.push(
      await runHttpProfile("presence_heartbeat", ports, 15, 4, async (port) => {
        const list = await fetch(`http://127.0.0.1:${port}/api/platform/contact/inquiries?limit=1`, {
          headers: staffHeaders(staffId),
        });
        const body = (await list.json().catch(() => ({ items: [] }))) as { items?: Array<{ id: string }> };
        const entityId = body.items?.[0]?.id ?? randomUUID();
        return timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/presence/heartbeat`, {
            method: "POST",
            headers: staffHeaders(staffId),
            body: JSON.stringify({ entityType: "inquiry", entityId, intent: "view" }),
          }),
        );
      }),
    );

    // --- Phase 4: poison + healthy mix ---
    const poisonType = `soak_poison_${runId.slice(-8)}`;
    await db.insert(crmJobsTable).values({
      type: poisonType,
      payload: { soakRunId: runId, intentional: true },
      status: "pending",
      runAt: new Date(),
      correlationId: `${runId}:poison:0`,
      maxAttempts: 1,
      idempotencyKey: `${runId}:poison:0`,
    });
    for (let j = 0; j < 8; j++) {
      await db.insert(crmJobsTable).values({
        type: "analytics",
        payload: { event: "soak_after_poison", n: j, soakRunId: runId },
        status: "pending",
        runAt: new Date(),
        correlationId: `${runId}:postpoison:${j}`,
        idempotencyKey: `${runId}:postpoison:${j}`,
      });
    }
    const drainPoison = await drainWorkload(runId, {
      timeoutMs: drainMs,
      expectedDeadTypes: [poisonType],
    });
    phases.push({
      name: "poison_mixed_with_healthy",
      poisonType,
      drain: {
        pass: drainPoison.pass,
        drain_ms: drainPoison.drain_ms,
        failReason: drainPoison.failReason,
        totals: drainPoison.final.totals,
        byType: drainPoison.final.byType,
      },
    });
    if (!drainPoison.pass) {
      cellPass = false;
      cellFailReason = cellFailReason ?? `poison: ${drainPoison.failReason}`;
    }

    // --- Phase 4b: retry storm (injected transient, classified) ---
    for (let j = 0; j < 12; j++) {
      await db.insert(crmJobsTable).values({
        type: "__test_fail_until",
        payload: { succeedOnAttempt: 2, soakRunId: runId },
        status: "pending",
        runAt: new Date(),
        correlationId: `${runId}:storm:${j}`,
        idempotencyKey: `${runId}:storm:${j}`,
        maxAttempts: 4,
      });
    }
    const drainStorm = await drainWorkload(runId, {
      timeoutMs: drainMs,
      expectedDeadTypes: [poisonType],
    });
    const stormRetries = classifyRetryTable(readPipelineEvents(label), runId).filter((r) => r.type === "__test_fail_until");
    const stormUnexpected = stormRetries.filter((r) => r.event === "retry" && !r.expected).length;
    phases.push({
      name: "retry_storm",
      drain: {
        pass: drainStorm.pass,
        drain_ms: drainStorm.drain_ms,
        failReason: drainStorm.failReason,
        totals: drainStorm.final.totals,
      },
      retries: stormRetries,
    });
    if (!drainStorm.pass || stormUnexpected > 0) {
      cellPass = false;
      cellFailReason = cellFailReason ?? `retry_storm: ${drainStorm.failReason ?? `unexpected=${stormUnexpected}`}`;
    }

    // --- Phase 4c: recurring mixed with backlog fairness ---
    const fairnessN = 20;
    for (let j = 0; j < fairnessN; j++) {
      await db.insert(crmJobsTable).values({
        type: "analytics",
        payload: { event: "soak_fairness", n: j, soakRunId: runId },
        status: "pending",
        runAt: new Date(Date.now() - 60_000),
        correlationId: `${runId}:fair:${j}`,
        idempotencyKey: `${runId}:fair:${j}`,
      });
    }
    const fairT0 = Date.now();
    let fairFirstAnalyticsMs: number | null = null;
    while (Date.now() - fairT0 < 8_000) {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM crm_jobs WHERE correlation_id LIKE $1 AND type='analytics' AND status='completed'`,
        [`${runId}:fair:%`],
      );
      if (Number(r.rows[0]?.n ?? 0) > 0) {
        fairFirstAnalyticsMs = Date.now() - fairT0;
        break;
      }
      await sleep(50);
    }
    const drainFair = await drainWorkload(runId, {
      timeoutMs: drainMs,
      expectedDeadTypes: [poisonType],
    });
    phases.push({
      name: "recurring_mixed_backlog_fairness",
      first_analytics_ms: fairFirstAnalyticsMs,
      drain: {
        pass: drainFair.pass,
        drain_ms: drainFair.drain_ms,
        failReason: drainFair.failReason,
        totals: drainFair.final.totals,
      },
    });
    if (!drainFair.pass || fairFirstAnalyticsMs == null) {
      cellPass = false;
      cellFailReason =
        cellFailReason ??
        (!drainFair.pass ? `fairness: ${drainFair.failReason}` : "fairness: analytics starved behind recurring");
    }

    // --- Phase 5: worker kill during backlog + replacement ---
    // Build backlog
    for (let j = 0; j < preKillN; j++) {
      await db.insert(crmJobsTable).values({
        type: "analytics",
        payload: { event: "soak_pre_kill", n: j, soakRunId: runId },
        status: "pending",
        runAt: new Date(),
        correlationId: `${runId}:prekill:${j}`,
        idempotencyKey: `${runId}:prekill:${j}`,
      });
    }
    await sleep(300);
    const killT0 = Date.now();
    const workerProcs = procs.filter((p) => p.kind === "worker");
    const victim = workerProcs[0];
    if (victim) {
      try {
        victim.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    // Keep submitting while backlog exists
    const afterKill = await runHttpProfile("contact_during_worker_kill", ports, 10, 4, (port, n) => {
      const corr = `${runId}:kill:${n}:${randomUUID()}`;
      return timed(() =>
        fetch(`http://127.0.0.1:${port}/api/contact/inquiries`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-request-id": corr },
          body: JSON.stringify(contactBody(runId, `${label}-kill`, n)),
        }),
      );
    });
    profiles.push(afterKill);
    // Replace killed worker
    if (victim) {
      // Wait past lease so SKIP LOCKED reclaim can pick killed-worker jobs.
      await sleep(jobLeaseMs + 500);
      const replacement = startProc("worker", `${victim.id}-repl`, ["dist/worker.mjs"], {
        DATABASE_URL: url,
        CRM_EMBED_WORKER: "false",
        CRM_ALLOW_TEST_JOBS: "true",
        CRM_GRAPH_SIMULATOR: "true",
        CRM_EMAIL_SIMULATOR: "true",
        CRM_SKIP_RUNTIME_SEED: "false",
        CRM_JOB_LEASE_MS: String(jobLeaseMs),
        DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX ?? "12",
        CRM_WORKER_CONCURRENCY: process.env.CRM_WORKER_CONCURRENCY ?? "4",
        CRM_JOB_PIPELINE_LOG: join(tmpDir, `${victim.id}-repl.pipeline.jsonl`),
        WORKER_ID: `${masterRunId}-${label}-w-repl`,
        CRM_WORKER_POLL_MS: "400",
      });
      procs.push(replacement);
      inventory.push({ id: replacement.id, kind: "worker", pid: replacement.child.pid, port: undefined });
    }
    const drainKill = await drainWorkload(runId, {
      timeoutMs: drainMs,
      expectedDeadTypes: [poisonType],
    });
    recovery_ms = Date.now() - killT0;
    phases.push({
      name: "worker_kill_backlog_replace",
      recovery_ms,
      http: afterKill,
      drain: {
        pass: drainKill.pass,
        drain_ms: drainKill.drain_ms,
        failReason: drainKill.failReason,
        totals: drainKill.final.totals,
        series: drainKill.series,
      },
    });
    if (!drainKill.pass || afterKill.error_rate > 0.15) {
      cellPass = false;
      cellFailReason =
        cellFailReason ??
        (!drainKill.pass ? `kill_drain: ${drainKill.failReason}` : `kill_http_error_rate=${afterKill.error_rate}`);
    } else if (
      recovery_ms != null &&
      recovery_ms > jobLeaseMs + CAPACITY_OBJECTIVES.worker_loss_recovery_lease_plus_ms
    ) {
      cellPass = false;
      cellFailReason = cellFailReason ?? `kill_recovery_ms=${recovery_ms}`;
    }

    // --- Phase 6: API kill (multi-api only) ---
    if (ports.length > 1) {
      const apiVictim = procs.find((p) => p.kind === "api");
      const killedPort = apiVictim?.port;
      if (apiVictim) {
        try {
          apiVictim.child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      const surviving = ports.filter((p) => p !== killedPort);
      const afterApi = await runHttpProfile("contact_after_api_kill", surviving, 10, 4, (port, n) => {
        const corr = `${runId}:apikill:${n}:${randomUUID()}`;
        return timed(() =>
          fetch(`http://127.0.0.1:${port}/api/contact/inquiries`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-request-id": corr },
            body: JSON.stringify(contactBody(runId, `${label}-apikill`, n)),
          }),
        );
      });
      profiles.push(afterApi);
      const drainApi = await drainWorkload(runId, {
        timeoutMs: drainMs,
        expectedDeadTypes: [poisonType],
      });
      phases.push({
        name: "api_kill_surviving",
        http: afterApi,
        drain: { pass: drainApi.pass, drain_ms: drainApi.drain_ms, failReason: drainApi.failReason, totals: drainApi.final.totals },
      });
      if (!drainApi.pass || afterApi.error_rate > 0.15) {
        cellPass = false;
        cellFailReason = cellFailReason ?? `api_kill: ${drainApi.failReason ?? afterApi.error_rate}`;
      }
    }

    const finalStats = await workloadJobStats(runId);
    const httpFail = profiles.filter((p) => p.error_rate > 0.15);
    if (httpFail.length) {
      cellPass = false;
      cellFailReason = cellFailReason ?? `http_errors: ${httpFail.map((p) => p.name).join(",")}`;
    }

    return {
      label,
      apis,
      workers,
      runId,
      pass: cellPass,
      failReason: cellFailReason,
      recovery_ms,
      inventory,
      profiles,
      phases,
      final_workload: finalStats,
      evidence_class: "local_isolated_clean_soak",
      note: "Not a production SLO claim. Pass requires workload drain, not HTTP latency alone.",
    };
  } finally {
    await stopAll(procs);
  }
}

const evidencePath = join(tmpDir, "load-soak-drain-clean.json");
const logPath = join(tmpDir, "load-soak-drain-clean.log");

console.log(JSON.stringify({ event: "start", masterRunId, database: "claimtagx_crm_soak", matrix: matrixSpec }));
const baseline = await assertCleanBaseline();
console.log(JSON.stringify({ event: "baseline_ok", baseline }));

const results = [];
for (const cell of matrixSpec.split(",").map((s) => s.trim()).filter(Boolean)) {
  const [a, w] = cell.split("x").map(Number);
  if (!a || !w) continue;
  // Between cells: ensure no leftover non-recurring workload from prior cell is required —
  // each cell uses distinct runId prefix. Recurring jobs may exist; that is OK.
  const r = await runCell(a, w);
  results.push(r);
  const line = JSON.stringify({
    label: r.label,
    pass: r.pass,
    failReason: r.failReason,
    recovery_ms: r.recovery_ms,
    phases: r.phases.map((p) => ({
      name: p.name,
      drain_ms: (p.drain as { drain_ms?: number } | undefined)?.drain_ms,
      drain_pass: (p.drain as { pass?: boolean } | undefined)?.pass,
      failReason: (p.drain as { failReason?: string | null } | undefined)?.failReason,
      totals: (p.drain as { totals?: unknown } | undefined)?.totals,
      rates: p.rates,
    })),
    profiles: r.profiles.map((p) => ({
      name: p.name,
      p50: p.p50,
      p95: p.p95,
      p99: p.p99,
      max: p.max,
      ok: p.ok,
      err: p.err,
      rps: p.throughput_rps,
      arrival_rps: p.arrival_rps,
      error_rate: p.error_rate,
    })),
    final_workload: r.final_workload.totals,
  });
  console.log(line);
}

const allPass = results.every((r) => r.pass);
writeFileSync(
  evidencePath,
  JSON.stringify(
    {
      masterRunId,
      database: "claimtagx_crm_soak",
      schema_head: "0019_crm_staff_routing_attributes.sql",
      capacity_objectives: CAPACITY_OBJECTIVES,
      worker_fixes: [
        "heartbeat abort on handler completion (removed ~2s teardown tax)",
        "bounded worker concurrency with per-type and inquiry keys",
        "claim batch sized to concurrency; recurring deprioritized",
        "lease reclaim does not increment attempts",
        "unknown/poison types dead-letter immediately",
      ],
      baseline,
      historical_invalid_log: "tmp/load-soak-beyond-matrix2.log",
      historical_verdict: "FAIL_queue_accumulation_not_drain",
      results,
      pass: allPass,
      evidence_class: "local_isolated_clean_soak",
      note: "Not production SLO evidence.",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ event: "done", pass: allPass, evidencePath, logPath: "stdout" }));
await pool.end().catch(() => undefined);
process.exit(allPass ? 0 : 3);
