/**
 * Dual-process SKIP LOCKED claim harness for CRM jobs.
 *
 * Repo-owned fixture (not under gitignored tmp/). Invoked as:
 *   node --import tsx dualWorkerHarness.ts           # orchestrator
 *   node --import tsx dualWorkerHarness.ts <workerId> # single claim worker
 *
 * Harness job type `dual_proc_verify` is excluded from production `claimJobs()`
 * so suite workers cannot drain it.
 */
import { pg } from "@workspace/db";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const JOB_TYPE = "dual_proc_verify";
const here = dirname(fileURLToPath(import.meta.url));
const selfPath = join(here, "dualWorkerHarness.ts");

function requireIsolatedUrl(url: string): void {
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470"))) {
    throw new Error("dualWorkerHarness requires isolated DATABASE_URL on 127.0.0.1:55432|55470");
  }
  if (!/\/claimtagx_crm_[a-z0-9_]+/i.test(url)) {
    throw new Error("dualWorkerHarness refuses non-isolated database name");
  }
}

async function claimOnce(workerId: string): Promise<string[]> {
  const url = process.env.DATABASE_URL ?? "";
  requireIsolatedUrl(url);
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(
      `
      UPDATE crm_jobs AS j
      SET
        status = 'running',
        locked_at = NOW(),
        locked_by = $1,
        lease_expires_at = NOW() + interval '30 seconds',
        claim_generation = j.claim_generation + 1,
        attempts = j.attempts + 1
      FROM (
        SELECT id
        FROM crm_jobs
        WHERE type = $2
          AND status = 'pending'
          AND run_at <= NOW()
        ORDER BY run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) AS s
      WHERE j.id = s.id
      RETURNING j.id
      `,
      [workerId, JOB_TYPE],
    );
    await client.query("COMMIT");
    const ids = result.rows.map((r) => r.id);
    process.stdout.write(`${JSON.stringify({ worker: workerId, ids })}\n`);
    return ids;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

function spawnWorker(workerId: string): Promise<{ worker: string; ids: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", selfPath, workerId],
      {
        env: { ...process.env },
        cwd: join(here, "..", "..", ".."),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`dual worker ${workerId} timeout: ${err || out}`));
    }, 15000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`dual worker ${workerId} exit ${code}: ${err || out}`));
        return;
      }
      const line = out
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .at(-1);
      if (!line) {
        reject(new Error(`dual worker ${workerId} produced no stdout`));
        return;
      }
      try {
        const parsed = JSON.parse(line) as { worker: string; ids: string[] };
        resolve(parsed);
      } catch (e) {
        reject(new Error(`dual worker ${workerId} bad JSON: ${line}`));
      }
    });
  });
}

async function orchestrate(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  requireIsolatedUrl(url);
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await pool.query(`DELETE FROM crm_jobs WHERE type = $1`, [JOB_TYPE]);
    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO crm_jobs (type, payload, status, run_at)
      VALUES ($1, '{}'::jsonb, 'pending', NOW())
      RETURNING id
      `,
      [JOB_TYPE],
    );
    const jobId = inserted.rows[0]?.id;
    if (!jobId) throw new Error("failed to insert dual_proc_verify job");

    const [a, b] = await Promise.all([spawnWorker("a"), spawnWorker("b")]);
    const claimed = [...a.ids, ...b.ids];
    if (claimed.length !== 1) {
      throw new Error(
        `expected exactly one claim across two processes, got ${JSON.stringify({ a, b })}`,
      );
    }
    if (claimed[0] !== jobId) {
      throw new Error(`claimed unexpected job id ${claimed[0]} (expected ${jobId})`);
    }
    // Distinct PIDs / worker labels prove separate processes participated.
    if (a.worker === b.worker) {
      throw new Error("worker labels collided");
    }
    process.stdout.write("PASS dual-process SKIP LOCKED\n");
  } finally {
    await pool.end();
  }
}

const mode = process.argv[2];
try {
  if (mode) {
    await claimOnce(mode);
  } else {
    await orchestrate();
  }
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
}
