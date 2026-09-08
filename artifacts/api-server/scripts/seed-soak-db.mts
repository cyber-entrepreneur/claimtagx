/**
 * Minimal seed for claimtagx_crm_soak (isolated only).
 * Taxonomy/workflows/SLA via ensureCrmSeeded + one owner staff for admin HTTP.
 */
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("127.0.0.1:55432") || !url.includes("claimtagx_crm_soak")) {
  console.error("Refusing seed outside claimtagx_crm_soak on 127.0.0.1:55432");
  process.exit(2);
}

async function main() {
  // Never skip seed on the dedicated soak database.
  process.env.CRM_SKIP_RUNTIME_SEED = "false";
  const { db, crmStaffTable, pool } = await import("@workspace/db");
  const { ensureCrmSeeded } = await import("../src/lib/crm/seed.ts");
  await ensureCrmSeeded();
  const seededCounts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM crm_taxonomy) AS taxonomy,
      (SELECT COUNT(*)::int FROM crm_qualification_models WHERE status='published') AS published_models,
      (SELECT COUNT(*)::int FROM crm_templates) AS templates,
      (SELECT COUNT(*)::int FROM crm_workflows) AS workflows,
      (SELECT COUNT(*)::int FROM crm_sla_policies) AS sla_policies
  `);
  const sc = seededCounts.rows[0] as Record<string, number>;
  if (!sc.published_models || !sc.taxonomy) {
    throw new Error(`Soak seed incomplete: ${JSON.stringify(sc)}`);
  }
  console.log(JSON.stringify({ event: "seed_counts", ...sc }));

  const email = `soak.owner.${randomUUID().slice(0, 8)}@example.com`;
  const [staff] = await db
    .insert(crmStaffTable)
    .values({
      email,
      emailNormalized: email.toLowerCase(),
      name: "Soak Owner",
      role: "owner",
      status: "active",
      permissions: [
        "inquiries.view",
        "inquiries.assign",
        "inquiries.status",
        "inquiries.priority",
        "inquiries.reply",
        "inquiries.note",
        "inquiries.forward",
        "inquiries.tags",
        "inquiries.export",
        "analytics.view",
        "jobs.inspect",
        "jobs.replay",
        "config.manage",
        "config.propose",
        "templates.manage",
        "governance.dsar",
      ],
    })
    .returning({ id: crmStaffTable.id, email: crmStaffTable.email });

  const baseline = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM crm_jobs WHERE status='pending') AS pending,
      (SELECT COUNT(*)::int FROM crm_jobs WHERE status='running') AS running,
      (SELECT COUNT(*)::int FROM crm_jobs WHERE status='dead') AS dead,
      (SELECT COUNT(*)::int FROM crm_jobs WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW()) AS active_leases,
      (SELECT COUNT(*)::int FROM crm_job_effects WHERE status IN ('pending','executing','uncertain','retryable_failed','provider_request_started')) AS nonterminal_effects,
      (SELECT COUNT(*)::int FROM crm_job_effects WHERE status='uncertain') AS uncertain_effects,
      (SELECT COUNT(*)::int FROM crm_export_jobs WHERE status IN ('pending','running')) AS incomplete_exports,
      (SELECT COUNT(*)::int FROM crm_marketing_versions WHERE status IN ('scheduled','publishing')) AS incomplete_publications,
      (SELECT COUNT(*)::int FROM crm_attachment_uploads WHERE status IN ('uploading','assembling','scanning','completing')) AS incomplete_uploads
  `);

  console.log(
    JSON.stringify(
      {
        database: "claimtagx_crm_soak",
        staff,
        baseline: baseline.rows[0],
      },
      null,
      2,
    ),
  );
  await pool.end().catch(() => undefined);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
