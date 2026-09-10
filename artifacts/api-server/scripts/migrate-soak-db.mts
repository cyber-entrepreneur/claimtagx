/**
 * Apply CRM migrations to DATABASE_URL (isolated soak DB expected).
 * Usage from artifacts/api-server:
 *   DATABASE_URL=.../claimtagx_crm_soak node --import tsx scripts/migrate-soak-db.mts
 */
import { applyCrmMigrations } from "@workspace/db/migrate";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("127.0.0.1:55432") || !url.includes("claimtagx_crm_soak")) {
  console.error("Refusing: DATABASE_URL must target claimtagx_crm_soak on 127.0.0.1:55432");
  process.exit(2);
}

const result = await applyCrmMigrations({ connectionString: url });
console.log(JSON.stringify(result, null, 2));
