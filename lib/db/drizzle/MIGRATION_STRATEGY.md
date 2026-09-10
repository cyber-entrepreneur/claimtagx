# CRM migration strategy

Canonical bootstrap is `applyCrmMigrations()` in `lib/db/src/migrate.ts`.

## Approach

A. Versioned baseline `0000_crm_baseline.sql` (CRM schema through incremental 0007) plus incrementals `0001`–`NNNN`.

- **Empty database:** execute `0000`, stamp `0001`–`0007` as absorbed, execute `0008+`.
- **Existing database that already has `crm_inquiries`:** stamp `0000` without executing it, then apply any unstamped incrementals (they are written `IF NOT EXISTS` / additive).
- **Never** use `drizzle-kit push --force` as a production or empty-database bootstrap.

## Ownership and locking

Migrators take `pg_advisory_lock(814203)` so two application instances cannot apply SQL concurrently. History lives in `crm_schema_migrations` (filename, sha256 checksum, applied_at, applied_by). Checksum drift fails the run.

## Transactions

Incrementals apply inside a transaction where PostgreSQL permits. The baseline dump is applied as a script (extension + DDL). There is no concurrent-index step in the current chain.

## Forward-fix

If a run fails mid-file, PostgreSQL rolls back that incremental transaction. Re-run `pnpm --filter @workspace/db run migrate:crm`. Do not rewrite already-applied checksums. New work belongs in a new numbered file.

## Rollback

See `ROLLBACK.md`. Production rollback requires explicit authorization. Baseline `0000` is not reversed in place; restore from backup instead.

## First-party auth (`0021` through `0023`)

Current head is `0023`. The auth chain is intentionally staged:

- `0021` creates the nine `auth_*` tables plus nullable
  `crm_staff.auth_account_id` and a partial unique index.
- `0022` adds hashed, single-use staff invite tokens.
- `0023` performs deterministic reconciliation by verified email, drops the
  retired hosted-IdP staff column after reconciliation, and adds the
  `crm_staff.auth_account_fk` relationship to `auth_accounts(id)`.

The chain never rewrites or reorders any migration `<= 0020`.

### Paths

- **Empty database → head:** `applyCrmMigrations()` executes `0000` (baseline
  through 0007 absorbed), stamps `0001`–`0007`, then applies `0008`–`0023` in
  order. Final `version` is the `0023` migration.
- **Upgrade from `0020` head:** databases already stamped through
  `0020_crm_omnichannel_inbox.sql` apply only `0021`–`0023`. No baseline
  re-execution occurs. `0021` creates empty auth tables and nullable links;
  `0023` links only verified, unique email matches before removing the retired
  hosted-IdP column from the live schema.

### Idempotency

Every object in `0021`/`0022` uses `IF NOT EXISTS` (tables, indexes,
`ADD COLUMN`) where PostgreSQL supports it, so re-running
`applyCrmMigrations()` after a partial apply is safe. `0023` also guards its
constraint creation and index/column removal. The migrator still guards against
re-application via `crm_schema_migrations` + checksum, so a clean re-run reports
`applied: []`.

### Retired staff identity → `auth_account_id`

`0021` kept the legacy staff identity column nullable for transition safety.
`0023` is the final cleanup:

- **Reconciliation:** only verified email identifiers in `auth_identifiers`
  are considered. The normalized staff email must match exactly, and there must
  be exactly one candidate account not already linked to another staff row.
- **No display-name matching:** names are ignored because they are not stable
  identity proof.
- **Unresolved staff:** rows with no deterministic match remain unlinked and
  active legacy rows are moved to `pending_activation` for invite/owner
  resolution.
- **Sole identity:** after `0023`, the staff identity relationship is
  `crm_staff.auth_account_id -> auth_accounts.id`. The retired hosted-IdP
  column is no longer part of the live schema.

The partial unique index `crm_staff_auth_account_uniq ... WHERE auth_account_id
IS NOT NULL` allows many un-migrated staff (`NULL`) to coexist while enforcing
one staff row per linked auth account.

### First-owner bootstrap (no default password)

There is **no default password** anywhere. The first owner is provisioned with a
single-use, expiring token:

1. Operator generates a random secret out-of-band; only its hash is stored in
   `auth_bootstrap_tokens (token_hash, expires_at)` with `consumed_at = NULL`.
2. The operator visits the bootstrap endpoint with the raw secret. The server
   hashes it, matches an unconsumed, unexpired `auth_bootstrap_tokens` row, and
   within one transaction: creates the owner `auth_accounts` row, its
   `auth_identifiers`/`auth_credentials` (from the owner-supplied password/MFA),
   links `crm_staff.auth_account_id`, and sets `consumed_at` +
   `consumed_by_account_id` on the token.
3. Consumed or expired tokens are rejected. Because the row is single-use
   (`consumed_at`) and time-boxed (`expires_at`), a leaked bootstrap URL cannot
   be replayed.
