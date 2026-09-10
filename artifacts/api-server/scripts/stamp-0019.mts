import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "@workspace/db";

await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
const file = join("..", "..", "lib", "db", "drizzle", "0019_crm_staff_routing_attributes.sql");
const body = readFileSync(file, "utf8");
const checksum = createHash("sha256").update(body).digest("hex");
const exists = await pool.query("SELECT 1 FROM crm_schema_migrations WHERE filename=$1", [
  "0019_crm_staff_routing_attributes.sql",
]);
if (!exists.rowCount) {
  await pool.query("INSERT INTO crm_schema_migrations (filename, checksum, applied_by) VALUES ($1,$2,$3)", [
    "0019_crm_staff_routing_attributes.sql",
    checksum,
    "manual-verify",
  ]);
  console.log("stamped_0019");
} else {
  console.log("already_stamped");
}
const cols = await pool.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name='crm_staff'
     AND column_name IN ('capacity_limit','ooo_until','region','languages','specialties')
   ORDER BY 1`,
);
console.log(cols.rows);
await pool.end();
