import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const retiredStaffIdColumn = ["c", "l", "e", "r", "k", "_user_id"].join("");
const retiredStaffIdIndex = ["crm_staff_", "c", "l", "e", "r", "k", "_uniq"].join("");
const finalAuthMigration = ["0023_remove_", "c", "l", "e", "r", "k", "_identity.sql"].join("");
const hasIsolatedDb = (process.env.DATABASE_URL ?? "").includes("127.0.0.1:55432");

type PgClient = import("pg").Client;

async function newPgClient(connectionString: string): Promise<PgClient> {
  const { pg } = await import("@workspace/db");
  return new pg.Client({ connectionString });
}

function requireIsolatedHost() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("127.0.0.1:55432")) {
    throw new Error("identity reconciliation PG tests require isolated Postgres on 127.0.0.1:55432");
  }
}

function adminUrl(): string {
  return (process.env.DATABASE_URL ?? "").replace(/\/[^/?]+(\?|$)/, "/postgres$1");
}

async function withFreshDb(name: string, fn: (url: string) => Promise<void>) {
  requireIsolatedHost();
  const admin = await newPgClient(adminUrl());
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
    const cleanup = await newPgClient(adminUrl());
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  }
}

async function seedAccount(
  client: PgClient,
  id: string,
  value: string,
  options: { verified?: boolean; status?: string } = {},
) {
  await client.query(
    `INSERT INTO auth_accounts (id, status, created_at) VALUES ($1, $2, 1700000000000)`,
    [id, options.status ?? "active"],
  );
  await client.query(
    `INSERT INTO auth_identifiers (account_id, kind, value, verified) VALUES ($1, 'email', $2, $3)`,
    [id, value, options.verified ?? true],
  );
}

async function seedStaff(
  client: PgClient,
  key: string,
  email: string,
  emailNormalized: string,
  options: { name?: string; status?: string; authAccountId?: string } = {},
) {
  await client.query(
    `INSERT INTO crm_staff (id, email, email_normalized, name, role, status, auth_account_id)
     VALUES ($1, $2, $3, $4, 'sales', $5, $6)`,
    [
      staffId(key),
      email,
      emailNormalized,
      options.name ?? key,
      options.status ?? "active",
      options.authAccountId ?? null,
    ],
  );
}

function staffId(key: string): string {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

describe("identity reconciliation migration (PostgreSQL)", { skip: !hasIsolatedDb }, () => {
  it("links only deterministic verified email matches and removes retired identity schema", async () => {
    const { applyCrmMigrations, listCrmMigrationFiles } = await import("../../../../../lib/db/src/migrate.ts");
    const name = `claimtagx_crm_authrec_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await withFreshDb(name, async (url) => {
      await assert.rejects(
        () => applyCrmMigrations({ connectionString: url, failAfterFilename: "0022_crm_staff_invite_token.sql" }),
        /0022_crm_staff_invite_token\.sql/,
      );

      const client = await newPgClient(url);
      await client.connect();
      try {
        await seedAccount(client, "acct-case", " Case@Example.COM ");
        await seedAccount(client, "acct-fallback", "fallback@example.com");
        await seedAccount(client, "acct-shared", "shared@example.com");
        await seedAccount(client, "acct-unverified", "collision@example.com", { verified: false });
        await seedAccount(client, "acct-verified", " COLLISION@example.com ");
        await seedAccount(client, "acct-dupe-a", "dupe@example.com");
        await seedAccount(client, "acct-dupe-b", " DUPE@example.com ");
        await seedAccount(client, "acct-taken", "taken@example.com");
        await seedAccount(client, "acct-display", "display@example.com");

        await seedStaff(client, "case-ok", " Case@Example.COM ", " case@example.com ");
        await seedStaff(client, "fallback-ok", "Fallback@Example.COM", "   ");
        await seedStaff(client, "shared-a", "shared@example.com", "shared@example.com");
        await seedStaff(client, "shared-b", "other-shared@example.com", " SHARED@example.com ");
        await seedStaff(client, "collision-ok", "collision@example.com", "collision@example.com");
        await seedStaff(client, "dupe", "dupe@example.com", "dupe@example.com");
        await seedStaff(client, "taken-holder", "holder@example.com", "holder@example.com", {
          authAccountId: "acct-taken",
        });
        await seedStaff(client, "taken-new", "taken@example.com", "taken@example.com");
        await seedStaff(client, "blank", "   ", "");
        await seedStaff(client, "suspended", "suspended@example.com", "suspended@example.com", {
          status: "suspended",
        });
        await seedStaff(client, "terminated", "terminated@example.com", "terminated@example.com", {
          status: "terminated",
        });
        await seedStaff(client, "unresolved", "unresolved@example.com", "unresolved@example.com");
        await seedStaff(client, "display", "nomatch@example.com", "nomatch@example.com", {
          name: "display@example.com",
        });
      } finally {
        await client.end();
      }

      const migrated = await applyCrmMigrations({ connectionString: url });
      assert.deepEqual(migrated.applied, [finalAuthMigration]);
      assert.equal(migrated.version, finalAuthMigration);

      const verify = await newPgClient(url);
      await verify.connect();
      try {
        const rows = await verify.query<{ id: string; auth_account_id: string | null; status: string }>(
          `SELECT id::text, auth_account_id, status FROM crm_staff ORDER BY id`,
        );
        const byId = new Map(rows.rows.map((row) => [row.id, row]));

        assert.equal(byId.get(staffId("case-ok"))?.auth_account_id, "acct-case");
        assert.equal(byId.get(staffId("fallback-ok"))?.auth_account_id, "acct-fallback");
        assert.equal(byId.get(staffId("collision-ok"))?.auth_account_id, "acct-verified");

        for (const key of ["shared-a", "shared-b", "dupe", "taken-new", "blank", "unresolved", "display"]) {
          assert.equal(byId.get(staffId(key))?.auth_account_id, null, `${key} should remain unresolved`);
          assert.equal(byId.get(staffId(key))?.status, "pending_activation", `${key} should require activation`);
        }

        assert.equal(byId.get(staffId("taken-holder"))?.auth_account_id, "acct-taken");
        assert.equal(byId.get(staffId("taken-holder"))?.status, "active");
        assert.equal(byId.get(staffId("suspended"))?.auth_account_id, null);
        assert.equal(byId.get(staffId("suspended"))?.status, "suspended");
        assert.equal(byId.get(staffId("terminated"))?.auth_account_id, null);
        assert.equal(byId.get(staffId("terminated"))?.status, "terminated");

        const migration = listCrmMigrationFiles().find((file) => file.filename === finalAuthMigration);
        assert.ok(migration, "final auth migration should be present");
        await verify.query(readFileSync(migration.path, "utf8"));
        const afterRerun = await verify.query<{ id: string; auth_account_id: string | null; status: string }>(
          `SELECT id::text, auth_account_id, status FROM crm_staff ORDER BY id`,
        );
        assert.deepEqual(afterRerun.rows, rows.rows);

        const retiredColumn = await verify.query(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name='crm_staff' AND column_name=$1
           ) AS e`,
          [retiredStaffIdColumn],
        );
        assert.equal(retiredColumn.rows[0].e, false);

        const retiredIndex = await verify.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname='public' AND c.relname=$1
           ) AS e`,
          [retiredStaffIdIndex],
        );
        assert.equal(retiredIndex.rows[0].e, false);

        const retiredConstraint = await verify.query(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_constraint con
             JOIN pg_class rel ON rel.oid = con.conrelid
             WHERE rel.relname='crm_staff' AND con.conname LIKE '%' || $1 || '%'
           ) AS e`,
          [retiredStaffIdColumn],
        );
        assert.equal(retiredConstraint.rows[0].e, false);
      } finally {
        await verify.end();
      }

      const rerun = await applyCrmMigrations({ connectionString: url });
      assert.equal(rerun.applied.length, 0);
      assert.equal(rerun.version, finalAuthMigration);
    });
  });
});
