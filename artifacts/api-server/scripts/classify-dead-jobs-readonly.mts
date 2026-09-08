/**
 * Read-only classification of dead jobs on claimtagx_crm_verify.
 * Does not delete or replay. Writes tmp/dead-jobs-classify-verify.json
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("127.0.0.1:55432") || !url.includes("claimtagx_crm_verify")) {
  console.error("Refusing: read-only classify requires claimtagx_crm_verify on 55432");
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const byType = await pool.query(`
  SELECT type, COUNT(*)::int AS n,
    ROUND(AVG(attempts)::numeric,1) AS avg_attempts,
    MIN(attempts) AS min_attempts,
    MAX(attempts) AS max_attempts,
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW()-created_at)))/3600.0,1) AS avg_age_h,
    ROUND(MAX(EXTRACT(EPOCH FROM (NOW()-created_at)))/3600.0,1) AS max_age_h
  FROM crm_jobs WHERE status='dead'
  GROUP BY type ORDER BY n DESC
`);

const byErrorClass = await pool.query(`
  SELECT
    CASE
      WHEN last_error LIKE 'unknown crm job type:%' THEN 'unknown_job_type_test_harness'
      WHEN last_error LIKE 'Failed query:%crm_notifications%' OR last_error LIKE 'Failed query: insert into "crm_notifications"%' THEN 'notify_staff_notification_insert'
      WHEN last_error LIKE 'Failed query:%' THEN 'failed_query_other'
      ELSE 'other'
    END AS error_class,
    COUNT(*)::int AS n
  FROM crm_jobs WHERE status='dead'
  GROUP BY 1 ORDER BY n DESC
`);

const samples = await pool.query(`
  SELECT id, type, attempts, LEFT(COALESCE(last_error,''), 200) AS last_error,
    correlation_id, causation_id, created_at, completed_at
  FROM crm_jobs WHERE status='dead'
  ORDER BY created_at DESC LIMIT 30
`);

const disposition = {
  unknown_job_type_test_harness: {
    produced_by_tests: true,
    genuine_product_defect: false,
    replayable: false,
    superseded: true,
    note: "Effect/CAS/ownership/behavior tests enqueue synthetic types that exhaust retries.",
  },
  notify_staff_notification_insert: {
    produced_by_tests: true,
    genuine_product_defect: "partial",
    replayable: false,
    superseded: false,
    note: "Historical handlerLease/test payloads used non-existent inquiry_id; notifyStaff now nulls missing inquiry. Remnant dead rows are historical; verify product path with real inquiry on soak DB.",
  },
  failed_query_other: {
    produced_by_tests: "unknown",
    genuine_product_defect: "investigate",
    replayable: "case_by_case",
    superseded: false,
  },
  other: {
    produced_by_tests: "unknown",
    genuine_product_defect: "investigate",
    replayable: "case_by_case",
    superseded: false,
  },
};

const report = {
  database: "claimtagx_crm_verify",
  read_only: true,
  total_dead: byType.rows.reduce((a: number, r: { n: number }) => a + r.n, 0),
  byType: byType.rows,
  byErrorClass: byErrorClass.rows,
  disposition_by_error_class: disposition,
  samples: samples.rows,
  action: "Do not delete or replay merely to improve metrics. Qualification evidence uses claimtagx_crm_soak.",
};

const out = join(root, "tmp", "dead-jobs-classify-verify.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ wrote: out, total_dead: report.total_dead, byErrorClass: report.byErrorClass }, null, 2));
await pool.end().catch(() => undefined);
