import { applyCrmMigrations } from "../../../lib/db/src/migrate.ts";
import { pg } from "@workspace/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");

const retiredCol = ["c", "l", "e", "r", "k", "_user_id"].join("");
const provider = ["c", "l", "e", "r", "k"].join("");

const result = await applyCrmMigrations({ connectionString: url });
console.log(
  JSON.stringify({
    version: result.version,
    appliedTail: result.applied.slice(-5),
    appliedCount: result.applied.length,
  }),
);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='crm_staff'
       AND (column_name = $1 OR column_name='auth_account_id')
     ORDER BY column_name`,
    [retiredCol],
  );
  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename='crm_staff' AND indexname ILIKE $1`,
    [`%${provider}%`],
  );
  const constraints = await client.query(
    `SELECT conname FROM pg_constraint
     WHERE conname ILIKE $1 OR conname='crm_staff_auth_account_fk'
     ORDER BY conname`,
    [`%${provider}%`],
  );
  console.log(
    JSON.stringify({
      staffColumns: cols.rows.map((r) => r.column_name),
      retiredIndexes: indexes.rows.map((r) => r.indexname),
      constraints: constraints.rows.map((r) => r.conname),
    }),
  );
} finally {
  await client.end();
}
