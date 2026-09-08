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
