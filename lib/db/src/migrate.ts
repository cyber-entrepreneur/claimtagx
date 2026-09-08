import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ADVISORY_LOCK = 814_203;
const INCREMENTAL_ABSORBED_BY_BASELINE = new Set([
  "0001_crm_durable_jobs.sql",
  "0002_crm_email_threading.sql",
  "0003_crm_ops.sql",
  "0004_crm_config_changes.sql",
  "0005_crm_job_ownership.sql",
  "0006_crm_governance_inbox.sql",
  "0007_crm_effects_lineage.sql",
]);

export type MigrationResult = {
  applied: string[];
  stamped: string[];
  skipped: string[];
  version: string;
  fingerprint?: string;
};

export type ApplyCrmMigrationsOpts = {
  connectionString?: string;
  failAfterFilename?: string;
  failAfterBaseline?:
    | "first_statement"
    | "early_table"
    | "midway"
    | "before_constraints"
    | "before_history";
  appliedBy?: string;
};

function drizzleDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

export function listCrmMigrationFiles(dir = drizzleDir()): Array<{ filename: string; path: string; checksum: string }> {
  return readdirSync(dir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((filename) => {
      const path = join(dir, filename);
      const checksum = createHash("sha256").update(readFileSync(path)).digest("hex");
      return { filename, path, checksum };
    });
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    const rest = sql.slice(i);
    const dollar = rest.match(/^\$[A-Za-z0-9_]*\$/);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) throw new Error("Unclosed dollar-quoted string in CRM SQL");
      buf += sql.slice(i, end + tag.length);
      i = end + tag.length;
      continue;
    }
    if (sql[i] === "'") {
      buf += sql[i++];
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        buf += sql[i];
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (sql[i] === ";") {
      const stmt = buf.trim();
      if (stmt) statements.push(stmt);
      buf = "";
      i++;
      continue;
    }
    buf += sql[i++];
  }
  const tail = buf.trim();
  if (tail) statements.push(tail);
  return statements;
}

export function requiredBaselineTables(baselineSql: string): string[] {
  const names = new Set<string>();
  const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(baselineSql))) {
    names.add(m[1]);
  }
  return [...names].sort();
}

async function tableExists(client: pg.PoolClient, name: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1
    ) AS exists`,
    [name],
  );
  return Boolean(res.rows[0]?.exists);
}

export async function computeCrmSchemaFingerprint(
  client: pg.PoolClient | pg.Client,
  tables?: string[],
): Promise<string> {
  const scope = tables && tables.length ? tables : null;
  const res = await client.query<{ fp: string }>(
    `
    SELECT md5(COALESCE(string_agg(part, E'\\n' ORDER BY part), '')) AS fp
    FROM (
      SELECT 't:' || c.relname AS part
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND (($1::text[] IS NULL AND c.relname LIKE 'crm_%') OR ($1::text[] IS NOT NULL AND c.relname = ANY($1)))
      UNION ALL
      SELECT 'pk:' || con.conname || ':' || rel.relname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public' AND con.contype = 'p'
        AND (($1::text[] IS NULL AND rel.relname LIKE 'crm_%') OR ($1::text[] IS NOT NULL AND rel.relname = ANY($1)))
      UNION ALL
      SELECT 'g:' || t.tgname || ':' || rel.relname
      FROM pg_trigger t
      JOIN pg_class rel ON rel.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND (($1::text[] IS NULL AND rel.relname LIKE 'crm_%') OR ($1::text[] IS NOT NULL AND rel.relname = ANY($1)))
      UNION ALL
      SELECT 'f:' || p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'crm_%'
      UNION ALL
      SELECT 'e:' || extname FROM pg_extension WHERE extname = 'pgcrypto'
    ) inventory
  `,
    [scope],
  );
  return res.rows[0]?.fp ?? "";
}

export async function inspectBaselineGaps(
  client: pg.PoolClient | pg.Client,
  requiredTables: string[],
): Promise<string[]> {
  const gaps: string[] = [];
  const tables = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'crm_%'`,
  );
  const have = new Set(tables.rows.map((r) => r.tablename));
  for (const name of requiredTables) {
    if (!have.has(name)) gaps.push(`missing table ${name}`);
  }
  const ext = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS exists`,
  );
  if (!ext.rows[0]?.exists) gaps.push("missing extension pgcrypto");
  const fn = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'crm_%'`,
  );
  if (fn.rows[0].n < 1 && requiredTables.length > 5) {
    gaps.push("missing CRM trigger functions");
  }
  if (have.has("crm_audit_events")) {
    const trig = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'crm_audit_events' AND NOT t.tgisinternal`,
    );
    if (trig.rows[0].n < 1) gaps.push("missing trigger on crm_audit_events");
  }
  if (have.has("crm_inquiries")) {
    const con = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
       WHERE n.nspname = 'public' AND rel.relname = 'crm_inquiries' AND con.contype = 'p'`,
    );
    if (con.rows[0].n < 1) gaps.push("missing primary key constraint on crm_inquiries");
  }
  return gaps;
}

function repairMessage(gaps: string[]): string {
  return [
    "CRM schema is incomplete or unknown; refusing to stamp migrations.",
    `Gaps: ${gaps.join("; ") || "fingerprint mismatch"}.`,
    "Repair: restore a verified dump into an isolated database, or DROP the isolated database and re-run applyCrmMigrations.",
    "Do not infer completeness from crm_inquiries alone. Do not use drizzle-kit push --force.",
    "See docs/contact-crm/ROLLBACK.md (forward-fix / unknown partial schema).",
  ].join(" ");
}

function shouldFailBaseline(stmtIndex: number, stmt: string, stmts: string[], mode?: ApplyCrmMigrationsOpts["failAfterBaseline"]) {
  if (!mode) return false;
  if (mode === "first_statement" && stmtIndex === 0) return true;
  if (mode === "early_table") {
    const firstTable = stmts.findIndex((s) => /CREATE TABLE/i.test(s));
    return stmtIndex === firstTable;
  }
  if (mode === "midway" && stmtIndex === Math.floor(stmts.length / 2)) return true;
  if (mode === "before_constraints") {
    const idx = stmts.findIndex((s) => /ADD CONSTRAINT|PRIMARY KEY/i.test(s) && /ALTER TABLE/i.test(s));
    return idx >= 0 && stmtIndex === Math.max(0, idx - 1);
  }
  return false;
}

async function applyBaselineInTransaction(
  client: pg.PoolClient,
  file: { filename: string; path: string; checksum: string },
  opts: ApplyCrmMigrationsOpts,
): Promise<string> {
  const sql = readFileSync(file.path, "utf8");
  const stmts = splitSqlStatements(sql);
  if (stmts.length < 10) {
    throw new Error(`Baseline ${file.filename} parsed to ${stmts.length} statements; refusing to apply`);
  }
  await client.query("BEGIN");
  try {
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      await client.query(stmt);
      if (shouldFailBaseline(i, stmt, stmts, opts.failAfterBaseline)) {
        throw new Error(`injected migration failure after baseline statement ${i} (${opts.failAfterBaseline})`);
      }
    }
    if (opts.failAfterBaseline === "before_history") {
      throw new Error("injected migration failure before migration-history insert");
    }
    const fingerprint = await computeCrmSchemaFingerprint(client, requiredBaselineTables(sql));
    await client.query(
      `INSERT INTO crm_schema_migrations (filename, checksum, applied_by) VALUES ($1, $2, $3)`,
      [file.filename, file.checksum, opts.appliedBy ?? "applyCrmMigrations"],
    );
    await client.query(
      `INSERT INTO crm_schema_baseline (id, fingerprint, checksum) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, checksum = EXCLUDED.checksum, applied_at = now()`,
      [fingerprint, file.checksum],
    );
    await client.query("COMMIT");
    return fingerprint;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function applyCrmMigrations(opts: ApplyCrmMigrationsOpts = {}): Promise<MigrationResult> {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for CRM migrations");
  const pool = new pg.Pool({ connectionString, max: 2 });
  const client = await pool.connect();
  const applied: string[] = [];
  const stamped: string[] = [];
  const skipped: string[] = [];
  let fingerprint: string | undefined;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_schema_migrations (
        filename text PRIMARY KEY NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        applied_by text,
        fingerprint text
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_schema_baseline (
        id integer PRIMARY KEY CHECK (id = 1),
        fingerprint text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await client.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM crm_schema_migrations",
    );
    const byName = new Map(existing.rows.map((row) => [row.filename, row.checksum]));
    const files = listCrmMigrationFiles();
    const baselineFile = files.find((f) => f.filename.startsWith("0000_"));
    const baselineSql = baselineFile ? readFileSync(baselineFile.path, "utf8") : "";
    const requiredTables = requiredBaselineTables(baselineSql);
    const inquiriesExist = await tableExists(client, "crm_inquiries");
    let executedBaseline = false;

    for (const file of files) {
      const prior = byName.get(file.filename);
      if (prior) {
        if (prior !== file.checksum) {
          throw new Error(
            `CRM migration checksum drift for ${file.filename}. Stored=${prior} file=${file.checksum}. Refusing to continue.`,
          );
        }
        if (file.filename.startsWith("0000_")) {
          // Fingerprint is the post-head inventory (tables + CRM functions/triggers), not the
          // post-0000 snapshot. Do not compare here while later migrations may still apply;
          // end-of-run verification covers fully-stamped databases.
          const gaps = await inspectBaselineGaps(client, requiredTables);
          if (gaps.length) throw new Error(repairMessage(gaps));
          fingerprint = await computeCrmSchemaFingerprint(client, requiredTables);
        }
        skipped.push(file.filename);
        continue;
      }

      const stamp = async (reason: "applied" | "stamped") => {
        await client.query(
          `INSERT INTO crm_schema_migrations (filename, checksum, applied_by) VALUES ($1, $2, $3)`,
          [file.filename, file.checksum, opts.appliedBy ?? "applyCrmMigrations"],
        );
        byName.set(file.filename, file.checksum);
        if (reason === "applied") applied.push(file.filename);
        else stamped.push(file.filename);
      };

      if (file.filename.startsWith("0000_")) {
        if (inquiriesExist) {
          const gaps = await inspectBaselineGaps(client, requiredTables);
          const currentFp = await computeCrmSchemaFingerprint(client, requiredTables);
          const recorded = await client.query<{ fingerprint: string; checksum: string }>(
            "SELECT fingerprint, checksum FROM crm_schema_baseline WHERE id = 1",
          );
          if (gaps.length) {
            throw new Error(repairMessage(gaps));
          }
          if (recorded.rows[0] && recorded.rows[0].fingerprint !== currentFp) {
            throw new Error(repairMessage([`schema checksum mismatch recorded=${recorded.rows[0].fingerprint} live=${currentFp}`]));
          }
          if (!recorded.rows[0]) {
            await client.query(
              `INSERT INTO crm_schema_baseline (id, fingerprint, checksum) VALUES (1, $1, $2)`,
              [currentFp, file.checksum],
            );
          }
          await stamp("stamped");
          fingerprint = currentFp;
          continue;
        }
        fingerprint = await applyBaselineInTransaction(client, file, opts);
        executedBaseline = true;
        applied.push(file.filename);
        byName.set(file.filename, file.checksum);
        if (opts.failAfterFilename === file.filename) {
          throw new Error(`injected migration failure after ${file.filename}`);
        }
        continue;
      }

      if (INCREMENTAL_ABSORBED_BY_BASELINE.has(file.filename) && executedBaseline) {
        await stamp("stamped");
        continue;
      }

      if (INCREMENTAL_ABSORBED_BY_BASELINE.has(file.filename) && inquiriesExist && byName.has("0000_crm_baseline.sql")) {
        const gaps = await inspectBaselineGaps(client, requiredTables);
        if (gaps.length) throw new Error(repairMessage(gaps));
        await stamp("stamped");
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(readFileSync(file.path, "utf8"));
        await client.query(
          `INSERT INTO crm_schema_migrations (filename, checksum, applied_by) VALUES ($1, $2, $3)`,
          [file.filename, file.checksum, opts.appliedBy ?? "applyCrmMigrations"],
        );
        await client.query("COMMIT");
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      }
      byName.set(file.filename, file.checksum);
      applied.push(file.filename);
      if (opts.failAfterFilename === file.filename) {
        throw new Error(`injected migration failure after ${file.filename}`);
      }
    }

    // Authoritative fingerprint is the live inventory after all stamped migrations.
    const liveHead = await computeCrmSchemaFingerprint(client, requiredTables);
    const recordedHead = await client.query<{ fingerprint: string }>(
      "SELECT fingerprint FROM crm_schema_baseline WHERE id = 1",
    );
    const pendingAfter = files.filter((f) => !byName.has(f.filename));
    if (pendingAfter.length === 0 && recordedHead.rows[0]) {
      if (applied.length === 0 && stamped.length === 0 && recordedHead.rows[0].fingerprint !== liveHead) {
        throw new Error(
          repairMessage([
            `schema checksum mismatch recorded=${recordedHead.rows[0].fingerprint} live=${liveHead}`,
          ]),
        );
      }
      await client.query(
        `UPDATE crm_schema_baseline SET fingerprint = $1, applied_at = now() WHERE id = 1`,
        [liveHead],
      );
    } else if (!recordedHead.rows[0] && byName.has("0000_crm_baseline.sql")) {
      await client.query(
        `INSERT INTO crm_schema_baseline (id, fingerprint, checksum) VALUES (1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, applied_at = now()`,
        [liveHead, baselineFile?.checksum ?? ""],
      );
    } else if (recordedHead.rows[0] && (applied.length > 0 || stamped.length > 0)) {
      await client.query(
        `UPDATE crm_schema_baseline SET fingerprint = $1, applied_at = now() WHERE id = 1`,
        [liveHead],
      );
    }
    fingerprint = liveHead;

    const version = files.at(-1)?.filename ?? "none";
    return { applied, stamped, skipped, version, fingerprint };
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK]);
    } catch {
      /* ignore */
    }
    client.release();
    await pool.end();
  }
}

export async function currentCrmSchemaVersion(connectionString?: string): Promise<string | null> {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<{ filename: string }>(
      "SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1",
    );
    return res.rows[0]?.filename ?? null;
  } finally {
    await client.end();
  }
}
