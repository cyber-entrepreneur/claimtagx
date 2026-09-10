import { pool } from "@workspace/db";

const r = await pool.query(`
  UPDATE crm_jobs SET status='pending', locked_by=null, locked_at=null, lease_expires_at=null
  WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
`);
console.log("requeued_stale", r.rowCount);
const s = await pool.query(`SELECT status, count(*)::int AS n FROM crm_jobs GROUP BY 1 ORDER BY 2 DESC`);
console.log(s.rows);
await pool.end();
