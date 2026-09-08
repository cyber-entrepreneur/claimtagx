/**
 * Multi-API / multi-worker soak beyond Contact submit (isolated PG only).
 * Run from artifacts/api-server:
 *   node --import tsx ../../tmp/claimtagx-crm-verify/multi-api-soak-beyond.mts
 * Not a production SLO claim.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db, pool, crmStaffTable, crmJobsTable } from "@workspace/db";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("127.0.0.1:55432") || !url.includes("claimtagx_crm_verify")) {
  console.error("Refusing: not isolated verify DB");
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiDir = join(root, "artifacts/api-server");
const node = process.execPath;
const matrixSpec = process.env.MATRIX ?? "1x1,2x2,4x2";
const targetP95 = Number(process.env.LOAD_TARGET_P95_MS || 3000);

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

function startProc(args: string[], env: Record<string, string>, logBase: string) {
  const child = spawn(node, args, {
    cwd: apiDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("exit", () => {
    try {
      writeFileSync(`${logBase}.out.log`, out);
      writeFileSync(`${logBase}.err.log`, err);
    } catch {
      /* ignore */
    }
  });
  return child;
}

async function waitLive(port: number, attempts = 50) {
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

async function stopTree(children: Array<ReturnType<typeof spawn>>) {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await sleep(400);
  for (const c of children) {
    try {
      if (!c.killed) c.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

async function ensureSoakStaff() {
  const email = `soak.admin.${Date.now()}@example.com`;
  const [s] = await db
    .insert(crmStaffTable)
    .values({
      email,
      emailNormalized: email,
      name: "Soak Admin",
      role: "owner",
      status: "active",
      permissions: [],
    })
    .returning({ id: crmStaffTable.id });
  return s!.id;
}

async function deferOldPendingJobs() {
  const r = await pool.query(`
    UPDATE crm_jobs
    SET run_at = NOW() + interval '7 days'
    WHERE status = 'pending'
      AND created_at < NOW() - interval '10 minutes'
      AND type NOT IN ('crm_export')
  `);
  const s = await pool.query(`
    UPDATE crm_jobs SET status='pending', locked_by=null, locked_at=null, lease_expires_at=null
    WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
  `);
  return { deferred: r.rowCount ?? 0, requeued: s.rowCount ?? 0 };
}

async function queueStats() {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'running')::int AS running,
      COUNT(*) FILTER (WHERE status = 'dead')::int AS dead,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(run_at) FILTER (WHERE status = 'pending'))) * 1000, 0)::int AS oldest_pending_age_ms
    FROM crm_jobs
  `);
  return result.rows[0] as {
    pending: number;
    running: number;
    dead: number;
    oldest_pending_age_ms: number;
  };
}

async function timed(fn: () => Promise<Response>) {
  const t0 = Date.now();
  let status = 0;
  let err = "";
  try {
    const res = await fn();
    status = res.status;
    if (!res.ok && status !== 429) {
      err = `${status}:${(await res.text().catch(() => "")).slice(0, 120)}`;
    } else {
      await res.arrayBuffer().catch(() => undefined);
    }
  } catch (e) {
    status = 0;
    err = String(e);
  }
  return { ms: Date.now() - t0, status, err };
}

type Profile = {
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
};

async function runProfile(
  name: string,
  ports: number[],
  staffId: string,
  total: number,
  concurrency: number,
  workerFn: (port: number, staffId: string, n: number) => Promise<{ ms: number; status: number; err: string }>,
): Promise<Profile> {
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
      const r = await workerFn(port, staffId, n);
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
    p50: pct(latencies, 0.5),
    p95: pct(latencies, 0.95),
    p99: pct(latencies, 0.99),
    max: latencies[latencies.length - 1] ?? 0,
    error_rate: Number((err / Math.max(1, ok + err + limited)).toFixed(4)),
    sampleErr,
  };
}

function staffHeaders(staff: string): HeadersInit {
  return { "content-type": "application/json", "x-crm-test-staff-id": staff };
}

function contactBody(prefix: string, label: string, n: number) {
  return {
    inquiryType: "general",
    firstName: prefix,
    lastName: `User${n}`,
    email: `${prefix.toLowerCase()}.${label}.${n}.${Date.now()}@example.com`,
    jobTitle: "Engineer",
    companyName: `${prefix} Company`,
    country: "US",
    phoneRaw: "+14155552671",
    message: `Synthetic soak message for ${prefix} profile case ${n} under multi-api load.`,
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

async function runCell(apis: number, workers: number) {
  const basePort = 18200;
  const children: Array<ReturnType<typeof spawn>> = [];
  const ports: number[] = [];
  const label = `${apis}x${workers}`;
  const staffId = await ensureSoakStaff();
  try {
    for (let w = 0; w < workers; w++) {
      children.push(
        startProc(
          ["dist/worker.mjs"],
          {
            DATABASE_URL: url,
            CRM_EMBED_WORKER: "false",
            CRM_ALLOW_TEST_JOBS: "true",
            WORKER_ID: `soak-worker-${label}-${w}`,
          },
          join(root, "tmp", `soak-${label}-worker${w}`),
        ),
      );
    }
    for (let a = 0; a < apis; a++) {
      const port = basePort + a;
      ports.push(port);
      children.push(
        startProc(
          ["dist/index.mjs"],
          {
            DATABASE_URL: url,
            PORT: String(port),
            LISTEN_HOST: "127.0.0.1",
            CRM_EMBED_WORKER: "false",
            CRM_SUBMIT_TIMING: "1",
            CRM_PUBLIC_SUBMIT_RATE_MAX: "5000",
            CRM_PUBLIC_EMAIL_SUBMIT_RATE_MAX: "5000",
            CRM_ADMIN_RATE_MAX: "5000",
            CRM_ALLOW_TEST_JOBS: "true",
            CRM_HTTP_TEST_AUTH: "true",
            PLATFORM_STAFF_SESSION_SECRET: "local-e2e-session-secret-not-for-production",
            NODE_ENV: "development",
          },
          join(root, "tmp", `soak-${label}-api${a}`),
        ),
      );
    }
    for (const port of ports) {
      if (!(await waitLive(port))) throw new Error(`API ${port} not live`);
    }

    const qBefore = await queueStats();
    const profiles: Profile[] = [];

    profiles.push(
      await runProfile("contact_submit", ports, staffId, 30, Math.min(8, apis * 4), (port, _s, n) =>
        timed(() =>
          fetch(`http://127.0.0.1:${port}/api/contact/inquiries`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(contactBody("Soak", label, n)),
          }),
        ),
      ),
    );

    profiles.push(
      await runProfile("admin_inbox_keyset", ports, staffId, 40, Math.min(10, apis * 3), (port, staff) =>
        timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/inquiries?limit=25&sort=createdAt&dir=desc`, {
            headers: staffHeaders(staff),
          }),
        ),
      ),
    );

    profiles.push(
      await runProfile("advanced_search", ports, staffId, 30, Math.min(8, apis * 3), (port, staff, n) =>
        timed(() =>
          fetch(
            `http://127.0.0.1:${port}/api/platform/contact/inquiries?search=Soak&inquiryType=general&limit=20&offset=${n % 5}`,
            { headers: staffHeaders(staff) },
          ),
        ),
      ),
    );

    profiles.push(
      await runProfile("saved_views_list", ports, staffId, 20, 5, (port, staff) =>
        timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/saved-views`, {
            headers: staffHeaders(staff),
          }),
        ),
      ),
    );

    profiles.push(
      await runProfile("bulk_read", ports, staffId, 12, 4, async (port, staff) => {
        const list = await fetch(`http://127.0.0.1:${port}/api/platform/contact/inquiries?limit=5`, {
          headers: staffHeaders(staff),
        });
        const body = (await list.json().catch(() => ({ items: [] }))) as { items?: Array<{ id: string }> };
        const ids = (body.items ?? []).slice(0, 3).map((x) => x.id).filter(Boolean);
        if (!ids.length) {
          return { ms: 0, status: 204, err: "" };
        }
        return timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/inquiries/bulk-read`, {
            method: "POST",
            headers: staffHeaders(staff),
            body: JSON.stringify({ ids }),
          }),
        );
      }),
    );

    profiles.push(
      await runProfile("export_enqueue", ports, staffId, 8, 2, (port, staff) =>
        timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/exports`, {
            method: "POST",
            headers: staffHeaders(staff),
            body: JSON.stringify({ columns: ["reference", "status"], filters: { inquiryType: "general" } }),
          }),
        ),
      ),
    );

    // Seed a real inquiry id for presence if possible
    let presenceEntityId = randomUUID();
    {
      const list = await fetch(`http://127.0.0.1:${ports[0]}/api/platform/contact/inquiries?limit=1`, {
        headers: staffHeaders(staffId),
      });
      const body = (await list.json().catch(() => ({ items: [] }))) as { items?: Array<{ id: string }> };
      if (body.items?.[0]?.id) presenceEntityId = body.items[0].id;
    }

    profiles.push(
      await runProfile("presence_heartbeat", ports, staffId, 20, 5, (port, staff) =>
        timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/presence/heartbeat`, {
            method: "POST",
            headers: staffHeaders(staff),
            body: JSON.stringify({ entityType: "inquiry", entityId: presenceEntityId, intent: "view" }),
          }),
        ),
      ),
    );

    profiles.push(
      await runProfile("dead_letter_list", ports, staffId, 15, 5, (port, staff) =>
        timed(() =>
          fetch(`http://127.0.0.1:${port}/api/platform/contact/jobs/dead?limit=20`, {
            headers: staffHeaders(staff),
          }),
        ),
      ),
    );

    profiles.push(
      await runProfile("admin_ops_volume", ports, staffId, 40, 10, (port, staff) =>
        timed(() => fetch(`http://127.0.0.1:${port}/api/platform/me`, { headers: staffHeaders(staff) })),
      ),
    );

    // Enqueue analytics jobs to exercise worker claiming under load
    for (let j = 0; j < 20; j++) {
      await db.insert(crmJobsTable).values({
        type: "analytics",
        payload: { event: "soak_claim", n: j },
        status: "pending",
        runAt: new Date(),
        idempotencyKey: `soak-claim-${label}-${j}-${randomUUID()}`,
      });
    }
    await sleep(2000);
    const qMid = await queueStats();

    const workerChild = children.find((c) => (c.spawnargs || []).some((a) => String(a).includes("worker")));
    const killT0 = Date.now();
    if (workerChild) {
      try {
        workerChild.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    const afterKillContact = await runProfile("contact_after_worker_kill", ports, staffId, 15, 5, (port, _s, n) =>
      timed(() =>
        fetch(`http://127.0.0.1:${port}/api/contact/inquiries`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(contactBody("Kill", label, n)),
        }),
      ),
    );
    profiles.push(afterKillContact);
    await sleep(2000);
    const qAfter = await queueStats();
    const recovery_ms = Date.now() - killT0;

    if (ports.length > 1) {
      const apiChild = children.find((c) => (c.spawnargs || []).some((a) => String(a).includes("index.mjs")));
      const killed = ports[0]!;
      if (apiChild) {
        try {
          apiChild.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      const surviving = ports.filter((p) => p !== killed);
      profiles.push(
        await runProfile("contact_after_api_kill", surviving, staffId, 15, 5, (port, _s, n) =>
          timed(() =>
            fetch(`http://127.0.0.1:${port}/api/contact/inquiries`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(contactBody("ApiKill", label, n)),
            }),
          ),
        ),
      );
    }

    const contact = profiles.find((p) => p.name === "contact_submit");
    const failProfiles = profiles.filter((p) => p.error_rate > 0.15);
    const pass =
      failProfiles.length === 0 &&
      (contact?.p95 ?? 99999) <= targetP95 &&
      (afterKillContact.error_rate ?? 1) <= 0.15;

    return {
      label,
      apis,
      workers,
      staffId,
      profiles,
      queue: { before: qBefore, mid: qMid, after: qAfter },
      recovery_ms,
      target_p95_ms: targetP95,
      pass,
      failProfiles: failProfiles.map((p) => p.name),
      evidence_class: "local_isolated",
      note: "Not a production SLO claim.",
    };
  } finally {
    await stopTree(children);
  }
}

const results = [];
const deferred = await deferOldPendingJobs();
console.log(JSON.stringify({ prep: deferred }));
for (const cell of matrixSpec.split(",").map((s) => s.trim()).filter(Boolean)) {
  const [a, w] = cell.split("x").map(Number);
  if (!a || !w) continue;
  const r = await runCell(a, w);
  results.push(r);
  console.log(
    JSON.stringify({
      label: r.label,
      pass: r.pass,
      failProfiles: r.failProfiles,
      recovery_ms: r.recovery_ms,
      queue: r.queue,
      profiles: r.profiles.map((p) => ({
        name: p.name,
        p50: p.p50,
        p95: p.p95,
        p99: p.p99,
        max: p.max,
        ok: p.ok,
        err: p.err,
        limited: p.limited,
        rps: p.throughput_rps,
        sampleErr: p.sampleErr || undefined,
      })),
    }),
  );
}

writeFileSync(join(root, "tmp", "load-multi-api-soak-beyond.json"), JSON.stringify(results, null, 2));
await pool.end().catch(() => undefined);
process.exit(results.every((r) => r.pass) ? 0 : 3);
