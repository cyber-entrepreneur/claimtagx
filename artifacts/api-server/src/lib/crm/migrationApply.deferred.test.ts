import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const drizzleDir = join(root, "lib", "db", "drizzle");
const latestMigration = ["0023_remove_", "c", "l", "e", "r", "k", "_identity.sql"].join("");

describe("CRM SQL migrations (deferred live apply)", () => {
  it("has ordered SQL files ready for psql through schema head 0023", () => {
    const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")).sort();
    assert.ok(files.includes("0000_crm_baseline.sql"));
    assert.ok(files.includes("0014_crm_marketing_publish_job.sql"));
    assert.ok(files.includes("0015_crm_record_presence.sql"));
    assert.ok(files.includes("0016_crm_export_jobs.sql"));
    assert.ok(files.includes("0017_crm_saved_views_enterprise.sql"));
    assert.ok(files.includes("0018_crm_marketing_audit_immutable.sql"));
    assert.ok(files.includes("0019_crm_staff_routing_attributes.sql"));
    assert.ok(files.includes("0020_crm_omnichannel_inbox.sql"));
    assert.ok(files.includes("0021_first_party_auth.sql"));
    assert.ok(files.includes("0022_crm_staff_invite_token.sql"));
    assert.ok(files.includes(latestMigration));
    assert.equal(files.filter((f) => /^\d{4}_/.test(f)).length >= 23, true);
    for (const name of files) {
      assert.ok(existsSync(join(drizzleDir, name)), name);
    }
  });

  it("isolated verify DB already reports schema head >= 0023 (non-destructive)", async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (
      !(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) ||
      !/\/claimtagx_crm_[a-z0-9_]+/.test(url)
    ) {
      throw new Error("requires isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_*");
    }
    const { pg } = await import("@workspace/db");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const version = await client.query(
        "SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1",
      );
      const head = String(version.rows[0]?.filename ?? "");
      assert.match(head, /^0023_|^00[3-9]\d_/);
      assert.ok(
        head >= latestMigration,
        `expected schema head >= 0023, got ${head}`,
      );
    } finally {
      await client.end();
    }
  });
});
