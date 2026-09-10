import { pool } from "@workspace/db";

const max = await pool.query(`
  SELECT MAX(reference) AS max_ref,
         MAX(NULLIF(regexp_replace(reference, '^CTX-2026-', ''), reference)::int) AS max_n
  FROM crm_inquiries
  WHERE reference LIKE 'CTX-2026-%'
`);
const ctr = await pool.query(`SELECT * FROM crm_inquiry_counters WHERE year = 2026`);
const clash = await pool.query(`SELECT reference FROM crm_inquiries WHERE reference IN ('CTX-2026-001453','CTX-2026-001454','CTX-2026-001455')`);
console.log({ max: max.rows[0], ctr: ctr.rows[0], clash: clash.rows });

const synced = await pool.query(`
  WITH m AS (
    SELECT COALESCE(MAX(NULLIF(regexp_replace(reference, '^CTX-2026-', ''), reference)::int), 0) AS n
    FROM crm_inquiries WHERE reference LIKE 'CTX-2026-%'
  )
  INSERT INTO crm_inquiry_counters (year, last_number)
  SELECT 2026, n FROM m
  ON CONFLICT (year) DO UPDATE SET last_number = GREATEST(crm_inquiry_counters.last_number, EXCLUDED.last_number)
  RETURNING *
`);
console.log("synced", synced.rows[0]);
await pool.end();
