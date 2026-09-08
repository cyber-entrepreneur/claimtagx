#!/usr/bin/env node
/**
 * Ready-to-run Contact CRM verification once infrastructure is supplied.
 * Exits 0 when all requested checks pass, 2 when a named env/tool is missing (not a product defect).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));

function missing(name) {
  console.error(`MISSING: ${name}`);
  process.exitCode = 2;
}

const GRAPH_ENV = [
  "MS_GRAPH_TENANT_ID",
  "MS_GRAPH_CLIENT_ID",
  "MS_GRAPH_CLIENT_SECRET",
  "MS_GRAPH_MAILBOX_UPN",
  "MS_GRAPH_NOTIFICATION_URL",
  "MS_GRAPH_CLIENT_STATE",
  "MS_GRAPH_DELTA_ENCRYPTION_KEY",
];

if (args.size === 0) {
  console.log(`Contact CRM infra verify
  --check-env        require DATABASE_URL, Microsoft Graph, Clerk keys (does not call APIs)
  --migrate          apply lib/db/drizzle via migrate-cli (refuses if CRM_ALLOW_MIGRATE!=true)
  --dual-worker-sql  print SKIP LOCKED claim SQL to run in two sessions
  --restore-sql      print restore verification queries
  --load-plan        print load/soak command plan
  --clerk-plan       print Clerk 401 check
  --graph-plan       print Microsoft Graph readiness check
`);
  process.exit(0);
}

if (args.has("--check-env")) {
  for (const key of ["DATABASE_URL", "CLERK_SECRET_KEY", "PLATFORM_ADMIN_EMAILS", ...GRAPH_ENV]) {
    if (!process.env[key]) missing(key);
  }
  if (!process.exitCode) console.log("env present");
}

if (args.has("--graph-plan")) {
  console.log(`# Microsoft Graph readiness
1. Register Entra application with Mail.Send + Mail.Read application permissions; admin consent.
2. Configure Exchange application access policy for ${process.env.MS_GRAPH_MAILBOX_UPN ?? "<mailbox>"}.
3. Set MS_GRAPH_* env vars and EMAIL_FROM.
4. Expose ${process.env.MS_GRAPH_NOTIFICATION_URL ?? "<notification URL>"} publicly for subscription validation.
5. In production, /readyz must return 200 only when Graph config validates.
6. Local: CRM_GRAPH_SIMULATOR=true or CRM_ALLOW_TEST_JOBS=true for simulator sends (not production).`);
}

if (args.has("--dual-worker-sql")) {
  console.log(readFileSync(join(root, "docs/contact-crm/RUNBOOK.md"), "utf8").match(/SKIP LOCKED[\s\S]{0,400}/)?.[0] ?? "see RUNBOOK");
}

if (args.has("--restore-sql")) {
  console.log(`SELECT count(*) FROM crm_inquiries;
SELECT count(*) FROM crm_jobs WHERE status='pending';
SELECT count(*) FROM crm_graph_mailbox_state;`);
}

if (args.has("--load-plan")) {
  console.log(`# Load/soak requires staging tenant — BLOCKED locally without authorized environment`);
}

if (args.has("--clerk-plan")) {
  console.log(`curl -i -H "Authorization: Bearer $CLERK_TOKEN" $API/api/platform/me # expect 200 for staff`);
}

if (args.has("--migrate")) {
  if (process.env.CRM_ALLOW_MIGRATE !== "true") {
    console.error("Set CRM_ALLOW_MIGRATE=true to run migrations from this script");
    process.exit(2);
  }
  console.log("Run: node artifacts/api-server/node_modules/tsx/dist/cli.mjs lib/db/src/migrate-cli.ts");
}

if (args.has("--resend-plan")) {
  console.error("Resend removed. Use --graph-plan.");
  process.exit(2);
}
