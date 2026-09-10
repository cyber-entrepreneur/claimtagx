/**
 * Post-live Contact E2E DB probes via isolated psql (no Node pg resolution required).
 * Usage: set credentials.env then:
 *   node --import tsx scripts/verify-live-contact-db.mts
 */
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("127.0.0.1:55432") || !url.includes("claimtagx_crm_verify")) {
  console.error("Refusing to run: DATABASE_URL must target isolated claimtagx_crm_verify on 55432");
  process.exit(2);
}

const psql =
  process.env.PSQL_PATH ??
  "C:\\Users\\AliAchkar\\scoop\\apps\\postgresql16\\current\\bin\\psql.exe";

function q(sqlText: string): string {
  const r = spawnSync(
    psql,
    ["-h", "127.0.0.1", "-p", "55432", "-U", process.env.PGUSER ?? "crm_verify", "-d", "claimtagx_crm_verify", "-t", "-A", "-c", sqlText],
    { env: process.env, encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  return (r.stdout ?? "").trim();
}

const since = process.env.CRM_E2E_VERIFY_SINCE_MINUTES ?? "180";
const inquiries = Number(q(`SELECT count(*) FROM crm_inquiries i JOIN crm_contacts c ON c.id=i.contact_id WHERE c.email LIKE '%@example.com' AND i.created_at > now() - interval '${since} minutes'`));
const types = q(`SELECT string_agg(inquiry_type, ',' ORDER BY inquiry_type) FROM (SELECT DISTINCT i.inquiry_type FROM crm_inquiries i JOIN crm_contacts c ON c.id=i.contact_id WHERE c.email LIKE '%@example.com' AND i.created_at > now() - interval '${since} minutes') t`);
const consents = Number(q(`SELECT count(*) FROM crm_consent_records WHERE created_at > now() - interval '${since} minutes'`));
const audits = Number(q(`SELECT count(*) FROM crm_audit_events WHERE action='inquiry.created' AND created_at > now() - interval '${since} minutes'`));
const slas = Number(q(`SELECT count(*) FROM crm_sla_instances WHERE created_at > now() - interval '${since} minutes'`));
const effects = q(`SELECT string_agg(kind || ':' || status || '=' || n::text, '; ' ORDER BY kind, status) FROM (SELECT kind, status, count(*)::int AS n FROM crm_job_effects WHERE created_at > now() - interval '${since} minutes' GROUP BY 1,2) t`);

const report = { inquiries, types, consents, audits, slas, effects };
console.log(JSON.stringify(report, null, 2));
if (inquiries < 1 || consents < 1 || audits < 1) {
  console.error("FAIL: live Contact DB probes");
  process.exit(1);
}
console.log("PASS: live Contact DB probes");
