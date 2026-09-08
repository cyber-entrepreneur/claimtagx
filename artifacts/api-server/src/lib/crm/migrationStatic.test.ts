import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "lib", "db", "drizzle");

describe("CRM SQL migrations (static)", () => {
  it("checks in ordered additive CRM migrations and rollback notes", () => {
    const files = readdirSync(drizzleDir);
    const names = files.filter((f) => f.endsWith(".sql")).sort();
    for (const name of ["0000_crm_baseline.sql", "0001_crm_durable_jobs.sql", "0002_crm_email_threading.sql", "0003_crm_ops.sql", "0004_crm_config_changes.sql", "0005_crm_job_ownership.sql", "0006_crm_governance_inbox.sql", "0007_crm_effects_lineage.sql", "0008_crm_enterprise_durability.sql", "0009_crm_effect_cas_outbound.sql", "0010_crm_microsoft_graph_mailbox.sql", "0011_crm_graph_recurring_jobs.sql", "0012_crm_marketing_cms.sql", "0013_crm_attachment_uploads.sql", "0014_crm_marketing_publish_job.sql", "0015_crm_record_presence.sql", "0016_crm_export_jobs.sql", "0017_crm_saved_views_enterprise.sql", "0018_crm_marketing_audit_immutable.sql", "0019_crm_staff_routing_attributes.sql", "0020_crm_omnichannel_inbox.sql", "ROLLBACK.md"]) {
      assert.ok(files.includes(name), name);
    }
    const sql = files
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
      .join("\n");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "crm_rate_limits"/);
    assert.match(sql, /crm_jobs/);
    assert.match(sql, /crm_config_changes/);
    assert.equal(/DROP TABLE crm_inquiries/i.test(sql), false);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS/);
    assert.match(sql, /NOT NULL DEFAULT/);
    assert.match(sql, /REFERENCES "crm_contacts"/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
    assert.equal(/DEFAULT "low"/.test(sql), false);
    assert.match(readFileSync(join(drizzleDir, "0020_crm_omnichannel_inbox.sql"), "utf8"), /DEFAULT 'low'/);
    assert.equal(/CREATE INDEX CONCURRENTLY/i.test(sql), false);
    assert.deepEqual(names, [
      "0000_crm_baseline.sql",
      "0001_crm_durable_jobs.sql",
      "0002_crm_email_threading.sql",
      "0003_crm_ops.sql",
      "0004_crm_config_changes.sql",
      "0005_crm_job_ownership.sql",
      "0006_crm_governance_inbox.sql",
      "0007_crm_effects_lineage.sql",
      "0008_crm_enterprise_durability.sql",
      "0009_crm_effect_cas_outbound.sql",
      "0010_crm_microsoft_graph_mailbox.sql",
      "0011_crm_graph_recurring_jobs.sql",
      "0012_crm_marketing_cms.sql",
      "0013_crm_attachment_uploads.sql",
      "0014_crm_marketing_publish_job.sql",
      "0015_crm_record_presence.sql",
      "0016_crm_export_jobs.sql",
      "0017_crm_saved_views_enterprise.sql",
      "0018_crm_marketing_audit_immutable.sql",
      "0019_crm_staff_routing_attributes.sql",
      "0020_crm_omnichannel_inbox.sql",
    ]);
    const rollback = readFileSync(join(drizzleDir, "ROLLBACK.md"), "utf8");
    assert.match(rollback, /0004 rollback/);
    assert.match(rollback, /0005 rollback/);
    assert.match(rollback, /0006 rollback/);
    assert.match(rollback, /0007 rollback/);
    assert.match(rollback, /0008 rollback/);
    assert.match(rollback, /0009 rollback/);
    assert.match(rollback, /0010 rollback/);
    assert.match(rollback, /0015|0016|0017|0018|0019|0020/);
  });

  it("keeps new columns additive or defaulted for existing rows", () => {
    const m1 = readFileSync(join(drizzleDir, "0001_crm_durable_jobs.sql"), "utf8");
    const m2 = readFileSync(join(drizzleDir, "0002_crm_email_threading.sql"), "utf8");
    const m3 = readFileSync(join(drizzleDir, "0003_crm_ops.sql"), "utf8");
    const m4 = readFileSync(join(drizzleDir, "0004_crm_config_changes.sql"), "utf8");
    assert.match(m1, /inquiry_type" text NOT NULL DEFAULT 'sales'/);
    assert.match(m2, /ADD COLUMN IF NOT EXISTS "message_id" text,/);
    assert.match(m3, /is_default" boolean NOT NULL DEFAULT false/);
    assert.match(m4, /holidays" jsonb NOT NULL DEFAULT/);
    assert.match(m4, /time_zone" text NOT NULL DEFAULT 'UTC'/);
    const m5 = readFileSync(join(drizzleDir, "0005_crm_job_ownership.sql"), "utf8");
    assert.match(m5, /claim_generation" integer NOT NULL DEFAULT 0/);
    assert.match(m5, /crm_audit_events_immutable/);
  });
});
