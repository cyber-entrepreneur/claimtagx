/**
 * Combined-qualification owned DBs on 127.0.0.1:55432 plus HTTP Contact submit proof on 0020.
 * Not a product file. Requires credentials.env already loaded into process.env.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { applyCrmMigrations } from "@workspace/db/migrate";
import { pg } from "@workspace/db";

const here = process.env.QUAL_OUT_DIR || dirname(fileURLToPath(import.meta.url));
const pgBin = "C:\\Users\\AliAchkar\\scoop\\apps\\postgresql16\\current\\bin";
const HEAD = "0020_crm_omnichannel_inbox.sql";

function requireIsolated(url: string, label: string) {
  if (!url.includes("127.0.0.1:55432")) throw new Error(`${label} must be 127.0.0.1:55432`);
}

function dbName(url: string): string {
  const u = new URL(url);
  return u.pathname.replace(/^\//, "").split("?")[0] ?? "";
}

function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function adminUrl(url: string): string {
  return withDb(url, "postgres");
}

async function recreate(url: string, name: string) {
  if (!/^claimtagx_crm_[a-z0-9_]+$/.test(name)) throw new Error(`refuse name ${name}`);
  const admin = new pg.Client({ connectionString: adminUrl(url) });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

async function head(url: string): Promise<string> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const v = await c.query("SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1");
    return String(v.rows[0]?.filename ?? "");
  } finally {
    await c.end();
  }
}

const verifyUrl = process.env.DATABASE_URL ?? "";
requireIsolated(verifyUrl, "DATABASE_URL");
const restoreUrl = process.env.DATABASE_URL_RESTORE ?? withDb(verifyUrl, "claimtagx_crm_qual_restore");
requireIsolated(restoreUrl, "restore");

const report: Record<string, unknown> = { schemaHeadExpected: HEAD };

const emptyName = "claimtagx_crm_qual_empty";
const from19Name = "claimtagx_crm_qual_from0019";
await recreate(verifyUrl, emptyName);
const emptyResult = await applyCrmMigrations({ connectionString: withDb(verifyUrl, emptyName) });
report.empty = { ...emptyResult, head: await head(withDb(verifyUrl, emptyName)) };
if (emptyResult.version !== HEAD) throw new Error(`empty db head ${emptyResult.version}`);

await recreate(verifyUrl, from19Name);
const from19Url = withDb(verifyUrl, from19Name);
try {
  await applyCrmMigrations({
    connectionString: from19Url,
    failAfterFilename: "0019_crm_staff_routing_attributes.sql",
  });
  throw new Error("expected failAfterFilename 0019 to throw");
} catch (err) {
  if (String(err).includes("expected failAfterFilename")) throw err;
}
const midHead = await head(from19Url);
if (midHead !== "0019_crm_staff_routing_attributes.sql") throw new Error(`mid head ${midHead}`);
const upgraded = await applyCrmMigrations({ connectionString: from19Url });
report.upgradeFrom0019 = { midHead, ...upgraded, head: await head(from19Url) };
if (upgraded.version !== HEAD) throw new Error(`upgrade head ${upgraded.version}`);

const verifyApplied = await applyCrmMigrations({ connectionString: verifyUrl });
report.verify = { ...verifyApplied, head: await head(verifyUrl), database: dbName(verifyUrl) };
if ((await head(verifyUrl)) !== HEAD) throw new Error("verify db is not 0020");

const dumpPath = join(here, "omni_qual_0020.dump.sql");
const dump = spawnSync(join(pgBin, "pg_dump.exe"), ["--no-owner", "--no-acl", "-f", dumpPath, verifyUrl], {
  encoding: "utf8",
  env: process.env,
});
if (dump.status !== 0) throw new Error(dump.stderr || dump.stdout || "pg_dump failed");

const restoreName = dbName(restoreUrl);
await recreate(verifyUrl, restoreName);
const restore = spawnSync(join(pgBin, "psql.exe"), ["-v", "ON_ERROR_STOP=1", "-f", dumpPath, restoreUrl], {
  encoding: "utf8",
  env: process.env,
});
if (restore.status !== 0) throw new Error(restore.stderr || restore.stdout || "psql restore failed");
report.dumpRestore = { dumpPath, restoreDatabase: restoreName, head: await head(restoreUrl) };
if ((await head(restoreUrl)) !== HEAD) throw new Error("restore db is not 0020");

process.env.NODE_ENV = "development";
process.env.CRM_HTTP_TEST_AUTH = "true";
process.env.CRM_BOT_ADAPTER = "honeypot_only";
process.env.CRM_ALLOW_TEST_JOBS = "true";
process.env.CRM_SKIP_RUNTIME_SEED = "true";

const { ensureCrmSeeded } = await import("../src/lib/crm/seed.ts");
await ensureCrmSeeded();
const { default: app } = await import("../src/app.ts");
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const addr = server.address() as AddressInfo;
const base = `http://127.0.0.1:${addr.port}`;
const email = `qual.submit.${randomUUID().slice(0, 8)}@example.com`;
const idempotencyKey = randomUUID();
const body = {
  firstName: "Qual",
  lastName: "Submit",
  jobTitle: "Buyer",
  companyName: "QualCo",
  email,
  country: "US",
  phoneRaw: "+14155552671",
  inquiryType: "general",
  useCaseKeys: [],
  message: "Combined qualification HTTP submit against schema 0020 omnichannel columns.",
  answers: {},
  termsAccepted: true,
  termsVersion: "2026-04-20",
  privacyPolicyVersion: "2026-04-20",
  locale: "en-US",
  attribution: { analyticsConsent: false, inquiry_type: "general" },
  idempotencyKey,
};
try {
  const res = await fetch(`${base}/api/contact/inquiries`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": randomUUID() },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { reference?: string; inquiryId?: string; error?: string };
  if (res.status !== 201) throw new Error(`submit HTTP ${res.status} ${JSON.stringify(json)}`);
  const c = new pg.Client({ connectionString: verifyUrl });
  await c.connect();
  try {
    const inquiry = await c.query(
      `SELECT id, reference, contact_id, channel, assigned_staff_id FROM crm_inquiries WHERE reference=$1`,
      [json.reference],
    );
    const inq = inquiry.rows[0];
    if (!inq) throw new Error("inquiry row missing");
    const contact = await c.query(`SELECT id, email FROM crm_contacts WHERE id=$1`, [inq.contact_id]);
    const identity = await c.query(
      `SELECT id, channel, contact_id FROM crm_channel_identities WHERE contact_id=$1`,
      [inq.contact_id],
    );
    const conversation = await c.query(
      `SELECT id, inquiry_id FROM crm_conversations WHERE inquiry_id=$1`,
      [inq.id],
    );
    const messages = await c.query(
      `SELECT id, direction, kind FROM crm_messages WHERE inquiry_id=$1`,
      [inq.id],
    );
    const sla = await c.query(`SELECT id, status FROM crm_sla_instances WHERE inquiry_id=$1`, [inq.id]);
    const consent = await c.query(`SELECT id, kind FROM crm_consent_records WHERE inquiry_id=$1`, [inq.id]);
    const audit = await c.query(`SELECT id, action FROM crm_audit_events WHERE inquiry_id=$1`, [inq.id]);
    const jobs = await c.query(
      `SELECT id, type, status FROM crm_jobs WHERE payload::text LIKE $1 LIMIT 20`,
      [`%${inq.id}%`],
    );
    const staffEmail = `qual.inbox.${randomUUID().slice(0, 8)}@example.com`;
    const { db, crmStaffTable } = await import("@workspace/db");
    const [staff] = await db
      .insert(crmStaffTable)
      .values({
        email: staffEmail,
        emailNormalized: staffEmail,
        name: "Qual Inbox",
        role: "admin",
        permissions: ["*"],
        status: "active",
      })
      .returning();
    const inbox = await fetch(`${base}/api/platform/contact/inquiries?search=${encodeURIComponent(json.reference!)}`, {
      headers: { "x-crm-test-staff-id": staff!.id },
    });
    const inboxJson = (await inbox.json()) as { items?: Array<{ reference?: string; channel?: string }> };
    const visible = (inboxJson.items ?? []).some((row) => row.reference === json.reference);
    report.submit = {
      httpStatus: res.status,
      reference: json.reference,
      contact: contact.rows[0]?.id ?? null,
      inquiry: inq.id,
      channel: inq.channel,
      assignedStaffId: inq.assigned_staff_id,
      identityChannels: identity.rows.map((r: { channel: string }) => r.channel),
      conversationId: conversation.rows[0]?.id ?? null,
      messageCount: messages.rowCount,
      slaStatuses: sla.rows.map((r: { status: string }) => r.status),
      consentKinds: consent.rows.map((r: { kind: string }) => r.kind),
      auditActions: audit.rows.map((r: { action: string }) => r.action),
      jobTypes: jobs.rows.map((r: { type: string }) => r.type),
      unifiedInboxVisible: visible,
      inboxStatus: inbox.status,
    };
    if (!contact.rows[0]) throw new Error("contact missing");
    if (!identity.rowCount) throw new Error("website channel identity missing");
    if (!conversation.rowCount) throw new Error("conversation missing");
    if (!messages.rowCount) throw new Error("inbound message missing");
    if (!consent.rowCount) throw new Error("consent missing");
    if (!sla.rowCount) throw new Error("SLA instance missing");
    if (!jobs.rowCount) throw new Error("outbox jobs missing");
    if (!visible) throw new Error("conversation/inquiry not visible in unified inbox");
  } finally {
    await c.end();
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

writeFileSync(join(here, "schema-0020-submit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
