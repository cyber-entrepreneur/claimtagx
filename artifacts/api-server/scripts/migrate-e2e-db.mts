/**
 * Apply CRM migrations to an isolated E2E database on 127.0.0.1.
 * Allowed names: claimtagx_crm_e2e or ctx_e2e_<8 hex>.
 * Ports: 55432 (historical) or 55470 (Windows Hyper-V excluded 55361-55460 blocks 55432 bind).
 */
import { applyCrmMigrations } from "@workspace/db/migrate";

const url = process.env.DATABASE_URL ?? "";
const allowedHostPort = /127\.0\.0\.1:(55432|55470)/.test(url);
const allowedName = /\/claimtagx_crm_e2e(?:\?|$)/.test(url) || /\/ctx_e2e_[a-f0-9]{8}(?:\?|$)/.test(url);
if (!allowedHostPort || !allowedName) {
  console.error("Refusing: DATABASE_URL must target claimtagx_crm_e2e or ctx_e2e_<hex> on 127.0.0.1:55432|55470");
  process.exit(2);
}

const result = await applyCrmMigrations({ connectionString: url });
console.log(JSON.stringify(result, null, 2));
