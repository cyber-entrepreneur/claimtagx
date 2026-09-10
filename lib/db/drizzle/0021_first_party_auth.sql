-- ClaimTagX first-party auth: additive migration (head after 0020).
-- Fully additive and idempotent: every object uses IF NOT EXISTS so re-running
-- against a partially-applied database is safe. No migrations <= 0020 are
-- rewritten or reordered.
--
-- The physical layout here is the canonical contract for the vendored Postgres
-- adapters in `lib/first-party-auth/src/adapters/postgres/schema.ts` (same table
-- and column names). The production API composes those adapters against the
-- shared `@workspace/db` connection, so the columns below must match exactly.
--
-- Timestamps are epoch milliseconds stored as bigint (clock-source agnostic).
-- Secret material is stored ONLY as hashes; jsonb columns must not hold secrets.

-- Root identity records.
CREATE TABLE IF NOT EXISTS auth_accounts (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  mfa_required boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  locked_until bigint
);

-- Email/phone/username identifiers resolving to an account.
-- PK (kind, value) enforces a globally-unique login handle.
CREATE TABLE IF NOT EXISTS auth_identifiers (
  account_id text NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  value text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  CONSTRAINT auth_identifiers_pk PRIMARY KEY (kind, value)
);
CREATE INDEX IF NOT EXISTS auth_identifiers_account_idx ON auth_identifiers (account_id);
CREATE INDEX IF NOT EXISTS auth_identifiers_verified_idx ON auth_identifiers (kind, verified);

-- Credentials (password hash, WebAuthn, TOTP, recovery). data jsonb holds
-- hashed/opaque material only.
CREATE TABLE IF NOT EXISTS auth_credentials (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at bigint NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS auth_credentials_account_idx ON auth_credentials (account_id);
CREATE INDEX IF NOT EXISTS auth_credentials_account_kind_idx ON auth_credentials (account_id, kind);

-- Session envelopes. expires_at is the effective (refresh) expiry.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  device_id text,
  issued_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  refresh_expires_at bigint,
  revoked_at bigint
);
CREATE INDEX IF NOT EXISTS auth_sessions_account_idx ON auth_sessions (account_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_device_idx ON auth_sessions (account_id, device_id);

-- Hashed access/refresh token slots bound to a session (both hashes unique).
-- One row per session; slots are nullable so access can be written before
-- refresh during login, and rotation supersedes the prior hash.
CREATE TABLE IF NOT EXISTS auth_session_tokens (
  session_id text PRIMARY KEY REFERENCES auth_sessions(id) ON DELETE CASCADE,
  access_hash text,
  refresh_hash text,
  context jsonb,
  access_expires_at bigint,
  refresh_expires_at bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_session_tokens_access_uniq ON auth_session_tokens (access_hash);
CREATE UNIQUE INDEX IF NOT EXISTS auth_session_tokens_refresh_uniq ON auth_session_tokens (refresh_hash);

-- Verification challenges with hashed codes and bounded attempts.
CREATE TABLE IF NOT EXISTS auth_verifications (
  id text PRIMARY KEY,
  account_id text REFERENCES auth_accounts(id) ON DELETE CASCADE,
  channel text NOT NULL,
  destination text NOT NULL,
  purpose text NOT NULL,
  code_hash_ref text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  consumed_at bigint,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5
);
CREATE INDEX IF NOT EXISTS auth_verifications_account_purpose_idx ON auth_verifications (account_id, purpose);
CREATE INDEX IF NOT EXISTS auth_verifications_expires_idx ON auth_verifications (expires_at);

-- Shared token-bucket rate-limit state keyed by an arbitrary bucket key.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key text PRIMARY KEY,
  tokens double precision NOT NULL,
  last_refill_ms bigint NOT NULL
);

-- Security/audit events. meta jsonb must not contain secrets; ip/ua hashed only.
CREATE TABLE IF NOT EXISTS auth_security_events (
  id text PRIMARY KEY,
  account_id text REFERENCES auth_accounts(id) ON DELETE SET NULL,
  type text NOT NULL,
  ip_hash text,
  user_agent_hash text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_security_events_account_idx ON auth_security_events (account_id, created_at);
CREATE INDEX IF NOT EXISTS auth_security_events_type_idx ON auth_security_events (type, created_at);

-- Single-use, expiring bootstrap token for provisioning the first owner.
-- The secret is stored only as a hash. There is NO default password.
CREATE TABLE IF NOT EXISTS auth_bootstrap_tokens (
  id text PRIMARY KEY,
  token_hash text NOT NULL,
  expires_at bigint NOT NULL,
  consumed_at bigint,
  consumed_by_account_id text REFERENCES auth_accounts(id) ON DELETE SET NULL,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_bootstrap_tokens_hash_uniq ON auth_bootstrap_tokens (token_hash);

-- Link CRM staff to a first-party auth account.
-- clerk_user_id is intentionally KEPT (nullable) for backfill/rollback; do not
-- drop it in this migration. See MIGRATION_STRATEGY.md "clerk_user_id retention".
ALTER TABLE crm_staff
  ADD COLUMN IF NOT EXISTS auth_account_id text;

-- Unique when present. Postgres unique indexes permit multiple NULLs, so this
-- allows un-migrated staff (auth_account_id IS NULL) to coexist while enforcing
-- one staff row per auth account once linked.
CREATE UNIQUE INDEX IF NOT EXISTS crm_staff_auth_account_uniq
  ON crm_staff (auth_account_id)
  WHERE auth_account_id IS NOT NULL;

COMMENT ON COLUMN crm_staff.auth_account_id IS 'FK-like link to auth_accounts.id (first-party auth). Nullable during Clerk->first-party transition.';
COMMENT ON COLUMN crm_staff.clerk_user_id IS 'DEPRECATED: retained (nullable) for backfill/rollback. Do not drop until auth_account_id backfill is verified.';
