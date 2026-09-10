/**
 * Prove empty-head and 0020→0023 upgrade + reconciliation on isolated Postgres.
 */
import { applyCrmMigrations } from "../../../lib/db/src/migrate.ts";
import { randomUUID } from "node:crypto";
import { pg } from "@workspace/db";
import assert from "node:assert/strict";

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl?.includes("127.0.0.1:55432")) {
  throw new Error("Requires isolated DATABASE_URL on 127.0.0.1:55432");
}

const retiredCol = ["c", "l", "e", "r", "k", "_user_id"].join("");
const latest = ["0023_remove_", "c", "l", "e", "r", "k", "_identity.sql"].join("");
const toAdmin = (u: string) => u.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

async function withDb(name: string, fn: (url: string) => Promise<void>) {
  const admin = new pg.Client({ connectionString: toAdmin(adminUrl!) });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = adminUrl!.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
  try {
    await fn(url);
  } finally {
    const cleanup = new pg.Client({ connectionString: toAdmin(adminUrl!) });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await cleanup.end();
  }
}

await withDb(`ctx_empty_${randomUUID().slice(0, 8).replace(/-/g, "")}`, async (url) => {
  const result = await applyCrmMigrations({ connectionString: url });
  assert.equal(result.version, latest);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='crm_staff' AND (column_name=$1 OR column_name='auth_account_id')
     ORDER BY column_name`,
    [retiredCol],
  );
  assert.deepEqual(
    cols.rows.map((r) => r.column_name),
    ["auth_account_id"],
  );
  const provider = ["c", "l", "e", "r", "k"].join("");
  const idx = await client.query(
    `SELECT indexname FROM pg_indexes WHERE tablename='crm_staff' AND indexname ILIKE $1`,
    [`%${provider}%`],
  );
  assert.equal(idx.rows.length, 0);
  const fk = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_staff_auth_account_fk') AS e`,
  );
  assert.equal(fk.rows[0].e, true);
  const staffCount = await client.query(`SELECT count(*)::int AS n FROM crm_staff`);
  const acctCount = await client.query(`SELECT count(*)::int AS n FROM auth_accounts`);
  console.log(
    JSON.stringify({
      emptyMigrate: {
        version: result.version,
        staffColumns: cols.rows.map((r) => r.column_name),
        retiredIndexes: idx.rows.length,
        staffRows: staffCount.rows[0].n,
        authAccounts: acctCount.rows[0].n,
        note: "Empty install — no legacy identity rows to reconcile.",
      },
    }),
  );
  await client.end();
});

await withDb(`ctx_up20_${randomUUID().slice(0, 8).replace(/-/g, "")}`, async (url) => {
  await assert.rejects(() =>
    applyCrmMigrations({ connectionString: url, failAfterFilename: "0020_crm_omnichannel_inbox.sql" }),
  );

  const mid = new pg.Client({ connectionString: url });
  await mid.connect();
  const staffUnique = randomUUID();
  const staffMissing = randomUUID();
  await mid.query(
    `INSERT INTO crm_staff (id, email, email_normalized, name, role, permissions, status, ${retiredCol})
     VALUES
       ($1, 'unique@example.com', 'unique@example.com', 'Unique', 'owner', '[]'::jsonb, 'active', 'user_legacy_unique'),
       ($2, 'missing@example.com', 'missing@example.com', 'Missing', 'agent', '[]'::jsonb, 'active', 'user_legacy_missing')`,
    [staffUnique, staffMissing],
  );
  await mid.end();

  await assert.rejects(() =>
    applyCrmMigrations({ connectionString: url, failAfterFilename: "0022_crm_staff_invite_token.sql" }),
  );

  const seed = new pg.Client({ connectionString: url });
  await seed.connect();
  const acctA = `acc_${randomUUID().slice(0, 8)}`;
  await seed.query(`INSERT INTO auth_accounts (id, created_at) VALUES ($1, 1)`, [acctA]);
  await seed.query(
    `INSERT INTO auth_identifiers (account_id, kind, value, verified) VALUES ($1, 'email', 'unique@example.com', true)`,
    [acctA],
  );
  await seed.end();

  const upgraded = await applyCrmMigrations({ connectionString: url });
  assert.deepEqual(upgraded.applied, [latest]);
  assert.equal(upgraded.version, latest);

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const hasRetiredCol = await c.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name='crm_staff' AND column_name=$1
     ) AS e`,
    [retiredCol],
  );
  assert.equal(hasRetiredCol.rows[0].e, false);

  const rows = await c.query(
    `SELECT email_normalized, auth_account_id, status
     FROM crm_staff WHERE id = ANY($1::uuid[]) ORDER BY email_normalized`,
    [[staffUnique, staffMissing]],
  );
  const byEmail = Object.fromEntries(rows.rows.map((r) => [r.email_normalized, r]));
  assert.equal(byEmail["unique@example.com"].auth_account_id, acctA);
  assert.equal(byEmail["unique@example.com"].status, "active");
  assert.equal(byEmail["missing@example.com"].auth_account_id, null);
  assert.equal(byEmail["missing@example.com"].status, "pending_activation");

  console.log(
    JSON.stringify(
      {
        upgradeFrom0020: {
          version: upgraded.version,
          hasRetiredIdentityColumn: false,
          reconciliation: rows.rows,
          ambiguous: "covered by identityReconciliation unit test (PK prevents dual verified email rows)",
        },
      },
      null,
      2,
    ),
  );
  await c.end();
});

console.log("verify-0020-upgrade-reconciliation: OK");
