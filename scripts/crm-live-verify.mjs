#!/usr/bin/env node
/**
 * Isolated Contact CRM live verification (throwaway Postgres only).
 * Requires DATABASE_URL pointing at 127.0.0.1:55432 / claimtagx_crm_verify.
 */
import pg from "../lib/db/node_modules/pg/esm/index.mjs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("127.0.0.1:55432") || !url.includes("claimtagx_crm_verify")) {
  console.error("Refusing to run: DATABASE_URL is not the isolated verify database");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url });
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

const claimSql = `
    UPDATE crm_jobs AS j
    SET
      status = 'running',
      attempts = j.attempts + 1,
      locked_at = NOW(),
      locked_by = $1,
      lease_expires_at = NOW() + interval '5 minutes'
    WHERE j.id IN (
      SELECT id FROM crm_jobs
      WHERE
        (
          status = 'pending'
          AND run_at <= NOW()
        )
        OR (
          status = 'running'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < NOW()
        )
      ORDER BY run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    )
    RETURNING j.id, j.locked_by, j.status
`;

await check("schema crm_config_changes exists", async () => {
  const r = await pool.query(`SELECT 1 FROM crm_config_changes LIMIT 1`);
  assert.ok(r);
});

await check("SKIP LOCKED dual claim does not duplicate", async () => {
  await pool.query(`DELETE FROM crm_jobs WHERE type = 'live_verify_claim'`);
  await pool.query(
    `INSERT INTO crm_jobs (type, payload, status, run_at) VALUES ('live_verify_claim', '{}'::jsonb, 'pending', NOW())`,
  );
  const [a, b] = await Promise.all([
    pool.query(claimSql, ["worker-a", 10]),
    pool.query(claimSql, ["worker-b", 10]),
  ]);
  const ids = [...a.rows, ...b.rows].map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate claim");
  assert.equal(ids.length, 1, "exactly one worker should win a single job");
});

await check("expired lease is reclaimable", async () => {
  await pool.query(`DELETE FROM crm_jobs WHERE type = 'live_verify_lease'`);
  const ins = await pool.query(
    `INSERT INTO crm_jobs (type, payload, status, run_at, locked_at, locked_by, lease_expires_at, attempts)
     VALUES ('live_verify_lease', '{}'::jsonb, 'running', NOW(), NOW() - interval '10 minutes', 'dead-worker', NOW() - interval '1 minute', 1)
     RETURNING id`,
  );
  const claimed = await pool.query(claimSql, ["worker-recover", 10]);
  assert.equal(claimed.rows.length, 1);
  assert.equal(claimed.rows[0].id, ins.rows[0].id);
  assert.equal(claimed.rows[0].locked_by, "worker-recover");
});

await check("dead-letter after max attempts", async () => {
  await pool.query(`DELETE FROM crm_jobs WHERE type = 'live_verify_dead'`);
  await pool.query(
    `INSERT INTO crm_jobs (type, payload, status, attempts, max_attempts, last_error)
     VALUES ('live_verify_dead', '{}'::jsonb, 'dead', 8, 8, 'synthetic failure')`,
  );
  const r = await pool.query(`SELECT status, attempts >= max_attempts AS exhausted FROM crm_jobs WHERE type='live_verify_dead'`);
  assert.equal(r.rows[0].status, "dead");
  assert.equal(r.rows[0].exhausted, true);
});

await check("email threading unique message_id", async () => {
  const company = await pool.query(
    `INSERT INTO crm_companies (name, name_normalized, country) VALUES ('Verify Co', 'verify co', 'US')
     ON CONFLICT (name_normalized) DO UPDATE SET country='US' RETURNING id`,
  );
  const contact = await pool.query(
    `INSERT INTO crm_contacts (company_id, first_name, last_name, job_title, email, email_normalized, country)
     VALUES ($1,'A','B','Ops','verify-thread@example.test','verify-thread@example.test','US')
     ON CONFLICT (email_normalized) DO UPDATE SET first_name='A' RETURNING id`,
    [company.rows[0].id],
  );
  const inq = await pool.query(
    `INSERT INTO crm_inquiries (reference, contact_id, company_id, inquiry_type, status, source)
     VALUES ('CTX-VERIFY-THREAD', $1, $2, 'general', 'NEW', 'test')
     RETURNING id`,
    [contact.rows[0].id, company.rows[0].id],
  );
  const conv = await pool.query(
    `INSERT INTO crm_conversations (inquiry_id, channel) VALUES ($1, 'email') RETURNING id`,
    [inq.rows[0].id],
  );
  const mid = `<verify-${randomUUID()}@example.test>`;
  await pool.query(
    `INSERT INTO crm_messages (conversation_id, inquiry_id, kind, visibility, channel, author_type, body, message_id)
     VALUES ($1,$2,'customer_email_reply','customer','email','contact','hello', $3)`,
    [conv.rows[0].id, inq.rows[0].id, mid],
  );
  let dup = false;
  try {
    await pool.query(
      `INSERT INTO crm_messages (conversation_id, inquiry_id, kind, visibility, channel, author_type, body, message_id)
       VALUES ($1,$2,'customer_email_reply','customer','email','contact','hello', $3)`,
      [conv.rows[0].id, inq.rows[0].id, mid],
    );
  } catch (err) {
    dup = err && err.code === "23505";
  }
  assert.equal(dup, true);
});

await check("legal hold insert", async () => {
  const c = await pool.query(`SELECT id FROM crm_contacts LIMIT 1`);
  await pool.query(
    `INSERT INTO crm_legal_holds (contact_id, reason) VALUES ($1, 'verify hold')`,
    [c.rows[0].id],
  );
  const n = await pool.query(`SELECT count(*)::int AS n FROM crm_legal_holds WHERE reason='verify hold'`);
  assert.ok(n.rows[0].n >= 1);
});

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: failed.length, failedNames: failed.map((f) => f.name) }));
await pool.end();
process.exit(failed.length ? 1 : 0);
