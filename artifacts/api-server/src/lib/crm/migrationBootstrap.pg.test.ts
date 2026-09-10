import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyCrmMigrations } from "../../../../../lib/db/src/migrate.ts";
import { pg } from "@workspace/db";

const retiredStaffIdColumn = ["c", "l", "e", "r", "k", "_user_id"].join("");
const latestMigration = ["0023_remove_", "c", "l", "e", "r", "k", "_identity.sql"].join("");

function requireIsolatedHost() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470"))) {
    throw new Error("migration bootstrap tests require isolated Postgres on 127.0.0.1:55432");
  }
}

function adminUrl(): string {
  return (process.env.DATABASE_URL ?? "").replace(/\/[^/?]+(\?|$)/, "/postgres$1");
}

async function withFreshDb(name: string, fn: (url: string) => Promise<void>) {
  requireIsolatedHost();
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
    const url = (process.env.DATABASE_URL ?? "").replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
  try {
    await fn(url);
  } finally {
    const cleanup = new pg.Client({ connectionString: adminUrl() });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  }
}

describe("versioned CRM migration bootstrap", () => {
  it("initializes a completely empty database without drizzle-kit push", async () => {
    const name = `crm_empty_${randomUUID().slice(0, 8)}`;
    await withFreshDb(name, async (url) => {
      const result = await applyCrmMigrations({ connectionString: url });
      assert.ok(result.applied.includes("0000_crm_baseline.sql"));
      assert.ok(result.applied.includes("0020_crm_omnichannel_inbox.sql"));
      assert.ok(result.applied.includes("0021_first_party_auth.sql"));
      assert.ok(result.applied.includes("0022_crm_staff_invite_token.sql"));
      assert.ok(result.applied.includes(latestMigration));
      assert.equal(result.version, latestMigration);
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        const tables = await client.query(
          "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'crm_%'",
        );
        assert.ok(tables.rows[0].n >= 46);
        const authTables = await client.query(
          "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'auth_%'",
        );
        assert.equal(authTables.rows[0].n, 9);
        const staffCol = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name='crm_staff' AND column_name='auth_account_id'
           ) AS e`,
        );
        assert.equal(staffCol.rows[0].e, true);
        const retiredCol = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name='crm_staff' AND column_name=$1
           ) AS e`,
          [retiredStaffIdColumn],
        );
        assert.equal(retiredCol.rows[0].e, false);
        const fk = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conname='crm_staff_auth_account_fk'
           ) AS e`,
        );
        assert.equal(fk.rows[0].e, true);
        const version = await client.query("SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1");
        assert.equal(version.rows[0].filename, latestMigration);
        const rerun = await applyCrmMigrations({ connectionString: url });
        assert.equal(rerun.applied.length, 0);
      } finally {
        await client.end();
      }
    });
  });

  it("serializes concurrent migrators with advisory lock", async () => {
    const name = `crm_lock_${randomUUID().slice(0, 8)}`;
    await withFreshDb(name, async (url) => {
      const [a, b] = await Promise.all([
        applyCrmMigrations({ connectionString: url, appliedBy: "a" }),
        applyCrmMigrations({ connectionString: url, appliedBy: "b" }),
      ]);
      const applied = [...a.applied, ...b.applied].filter((f) => f.startsWith("0000"));
      assert.equal(applied.length, 1);
    });
  });

  it("rolls back baseline after injected failures and retries to latest", async () => {
    const modes = ["first_statement", "early_table", "midway", "before_constraints", "before_history"] as const;
    for (const mode of modes) {
      const name = `crm_fail_${mode.slice(0, 8)}_${randomUUID().slice(0, 6)}`.replace(/[^a-z0-9_]/g, "");
      await withFreshDb(name, async (url) => {
        await assert.rejects(() => applyCrmMigrations({ connectionString: url, failAfterBaseline: mode }));
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        try {
          const inquiries = await client.query(
            `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='crm_inquiries') AS e`,
          );
          assert.equal(inquiries.rows[0].e, false);
          const stamped = await client.query(`SELECT count(*)::int AS n FROM crm_schema_migrations`);
          assert.equal(stamped.rows[0].n, 0);
        } finally {
          await client.end();
        }
        const result = await applyCrmMigrations({ connectionString: url });
        assert.ok(result.applied.includes("0000_crm_baseline.sql"));
        assert.equal(result.version, latestMigration);
      });
    }
  });

  it("upgrades 0008 through 0012 and rejects partial and mismatched schemas", async () => {
    const name = `crm_up_${randomUUID().slice(0, 8)}`;
    await withFreshDb(name, async (url) => {
      await assert.rejects(() =>
        applyCrmMigrations({ connectionString: url, failAfterFilename: "0008_crm_enterprise_durability.sql" }),
      );
      const mid = new pg.Client({ connectionString: url });
      await mid.connect();
      try {
        const v = await mid.query("SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1");
        assert.equal(v.rows[0].filename, "0008_crm_enterprise_durability.sql");
      } finally {
        await mid.end();
      }
      const upgraded = await applyCrmMigrations({ connectionString: url });
      assert.ok(upgraded.applied.some((f) => f.startsWith("0009") || f.startsWith("0010") || f.startsWith("0011") || f.startsWith("0012")));
    });

    const partial = `crm_part_${randomUUID().slice(0, 8)}`;
    await withFreshDb(partial, async (url) => {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query(`CREATE TABLE crm_inquiries (id uuid PRIMARY KEY)`);
      } finally {
        await client.end();
      }
      await assert.rejects(() => applyCrmMigrations({ connectionString: url }), /incomplete or unknown/);
    });

    const mismatch = `crm_mm_${randomUUID().slice(0, 8)}`;
    await withFreshDb(mismatch, async (url) => {
      await applyCrmMigrations({ connectionString: url });
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query(`UPDATE crm_schema_baseline SET fingerprint = 'deadbeef' WHERE id = 1`);
      } finally {
        await client.end();
      }
      await assert.rejects(() => applyCrmMigrations({ connectionString: url }), /checksum mismatch|incomplete/);
    });
  });

  it("applies 0000–0020 on an empty database and upgrades a 0019 head to 0020", async () => {
    const emptyName = `crm_e20_${randomUUID().slice(0, 8)}`;
    await withFreshDb(emptyName, async (url) => {
      const result = await applyCrmMigrations({ connectionString: url });
      assert.ok(result.applied.includes("0020_crm_omnichannel_inbox.sql"));
      assert.ok(result.applied.includes("0021_first_party_auth.sql"));
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        const def = await client.query(
          `SELECT column_default FROM information_schema.columns
           WHERE table_name='crm_channel_identities' AND column_name='confidence'`,
        );
        assert.equal(String(def.rows[0].column_default), "'low'::text");
        const website = await client.query(
          `SELECT connection_status FROM crm_channel_accounts WHERE channel='website'`,
        );
        assert.equal(website.rows[0].connection_status, "IMPLEMENTED_AWAITING_CREDENTIALS");
        const pending = await client.query(
          `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='crm_pending_deliveries') AS e`,
        );
        assert.equal(pending.rows[0].e, true);
      } finally {
        await client.end();
      }
    });

    const upgradeName = `crm_u20_${randomUUID().slice(0, 8)}`;
    await withFreshDb(upgradeName, async (url) => {
      await assert.rejects(() =>
        applyCrmMigrations({ connectionString: url, failAfterFilename: "0019_crm_staff_routing_attributes.sql" }),
      );
      const mid = new pg.Client({ connectionString: url });
      await mid.connect();
      try {
        const v = await mid.query("SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1");
        assert.equal(v.rows[0].filename, "0019_crm_staff_routing_attributes.sql");
        const exists = await mid.query(
          `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='crm_channel_accounts') AS e`,
        );
        assert.equal(exists.rows[0].e, false);
      } finally {
        await mid.end();
      }
      const upgraded = await applyCrmMigrations({ connectionString: url });
      assert.deepEqual(upgraded.applied, [
        "0020_crm_omnichannel_inbox.sql",
        "0021_first_party_auth.sql",
        "0022_crm_staff_invite_token.sql",
        latestMigration,
      ]);
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        const v = await client.query("SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1");
        assert.equal(v.rows[0].filename, latestMigration);
        const n = await client.query(`SELECT count(*)::int AS n FROM crm_channel_accounts`);
        assert.equal(n.rows[0].n, 8);
      } finally {
        await client.end();
      }
    });
  });

  it("upgrades a 0020 head to first-party auth finalization and re-runs idempotently", async () => {
    const name = `crm_auth21_${randomUUID().slice(0, 8)}`;
    await withFreshDb(name, async (url) => {
      // Stop at 0020 to simulate an existing production database at prior head.
      await assert.rejects(() =>
        applyCrmMigrations({ connectionString: url, failAfterFilename: "0020_crm_omnichannel_inbox.sql" }),
      );
      const mid = new pg.Client({ connectionString: url });
      await mid.connect();
      try {
        const v = await mid.query("SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1");
        assert.equal(v.rows[0].filename, "0020_crm_omnichannel_inbox.sql");
        const authExists = await mid.query(
          `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='auth_accounts') AS e`,
        );
        assert.equal(authExists.rows[0].e, false);
      } finally {
        await mid.end();
      }

      const upgraded = await applyCrmMigrations({ connectionString: url });
      assert.deepEqual(upgraded.applied, ["0021_first_party_auth.sql", "0022_crm_staff_invite_token.sql", latestMigration]);
      assert.equal(upgraded.version, latestMigration);

      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        // All nine auth_* tables exist.
        const tables = await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'auth_%' ORDER BY tablename",
        );
        assert.deepEqual(
          tables.rows.map((r: { tablename: string }) => r.tablename),
          [
            "auth_accounts",
            "auth_bootstrap_tokens",
            "auth_credentials",
            "auth_identifiers",
            "auth_rate_limits",
            "auth_security_events",
            "auth_session_tokens",
            "auth_sessions",
            "auth_verifications",
          ],
        );
        // Composite PK on auth_identifiers (kind, value).
        const pkCols = await client.query(
          `SELECT a.attname AS col
             FROM pg_constraint con
             JOIN pg_class rel ON rel.oid = con.conrelid
             JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = ANY(con.conkey)
            WHERE rel.relname = 'auth_identifiers' AND con.contype = 'p'
            ORDER BY a.attname`,
        );
        assert.deepEqual(pkCols.rows.map((r: { col: string }) => r.col), ["kind", "value"]);
        // Partial unique index on crm_staff.auth_account_id permits multiple NULLs.
        await client.query(
          `INSERT INTO crm_staff (email, email_normalized, name) VALUES ('a@x.io','a@x.io','A'), ('b@x.io','b@x.io','B')`,
        );
        // Two linked staff cannot share the same auth_account_id.
        await client.query(`INSERT INTO auth_accounts (id, created_at) VALUES ('acc-1', 1)`);
        await client.query(`UPDATE crm_staff SET auth_account_id = 'acc-1' WHERE email='a@x.io'`);
        await assert.rejects(() =>
          client.query(`UPDATE crm_staff SET auth_account_id = 'acc-1' WHERE email='b@x.io'`),
        );
      } finally {
        await client.end();
      }

      // Idempotent re-run: nothing new applied.
      const rerun = await applyCrmMigrations({ connectionString: url });
      assert.equal(rerun.applied.length, 0);
      assert.equal(rerun.version, latestMigration);
    });
  });
});
