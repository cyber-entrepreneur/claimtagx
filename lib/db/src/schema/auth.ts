// ClaimTagX first-party auth schema (owned by ClaimTagX, independent of hosted IdPs).
//
// All tables are prefixed `auth_` to avoid collisions with the existing CRM
// tables (`crm_*`). Timestamps are stored as epoch milliseconds in `bigint`
// columns (mode: "number") so the auth layer stays clock-source agnostic and
// portable across the API server and edge runtimes.
//
// IMPORTANT: These Drizzle definitions are the DB-package mirror of the
// canonical adapter schema in
// `lib/first-party-auth/src/adapters/postgres/schema.ts`. The physical column
// layout MUST match that adapter schema (same table + column names) because the
// production composition (`artifacts/api-server/src/lib/auth/composeAuthPlatform.ts`)
// wires the vendored `Postgres*` adapters against the shared `@workspace/db`
// connection. Migration `0021_first_party_auth.sql` creates these exact tables.
//
// Secret material is NEVER stored in plaintext. Credentials, tokens, codes and
// bootstrap secrets are persisted only as hashes; `data`/`meta`/`context` jsonb
// columns must not contain plaintext secrets.
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type AuthJsonMap = Record<string, unknown>;

const epoch = (name: string) => bigint(name, { mode: "number" });

/**
 * Root identity record. One row per authenticatable principal (staff owner,
 * staff member, handler, or service principal).
 */
export const authAccountsTable = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("active"),
  mfaRequired: boolean("mfa_required").notNull().default(false),
  createdAt: epoch("created_at").notNull(),
  lockedUntil: epoch("locked_until"),
});

/**
 * Verified/unverified identifiers (email, phone, username) that resolve to an
 * account. Primary key is (kind, value) so an identifier is globally unique.
 */
export const authIdentifiersTable = pgTable(
  "auth_identifiers",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => authAccountsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    verified: boolean("verified").notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.kind, t.value] }),
    accountIdx: index("auth_identifiers_account_idx").on(t.accountId),
    verifiedIdx: index("auth_identifiers_verified_idx").on(t.kind, t.verified),
  }),
);

/**
 * Authentication credentials (password hash, WebAuthn credential, TOTP secret,
 * recovery codes). `data` holds hashed/opaque material only — never plaintext
 * secrets. The discriminated `Credential` union is stored as `kind` + jsonb.
 */
export const authCredentialsTable = pgTable(
  "auth_credentials",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => authAccountsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    createdAt: epoch("created_at").notNull(),
    data: jsonb("data").$type<AuthJsonMap>().notNull().default({}),
  },
  (t) => ({
    accountIdx: index("auth_credentials_account_idx").on(t.accountId),
    accountKindIdx: index("auth_credentials_account_kind_idx").on(t.accountId, t.kind),
  }),
);

/**
 * Session envelope. `expires_at` carries the effective (refresh) expiry the
 * session resolver enforces; `refresh_expires_at` mirrors it for the token
 * service. Revoking a session sets `revoked_at`.
 */
export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => authAccountsTable.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
    issuedAt: epoch("issued_at").notNull(),
    expiresAt: epoch("expires_at").notNull(),
    refreshExpiresAt: epoch("refresh_expires_at"),
    revokedAt: epoch("revoked_at"),
  },
  (t) => ({
    accountIdx: index("auth_sessions_account_idx").on(t.accountId),
    expiresIdx: index("auth_sessions_expires_idx").on(t.expiresAt),
    deviceIdx: index("auth_sessions_device_idx").on(t.accountId, t.deviceId),
  }),
);

interface StoredAuthContext {
  readonly accountId: string;
  readonly sessionId: string;
  readonly deviceId?: string;
  readonly scopes: readonly string[];
}

/**
 * One row per session holding the SHA-256 hashes (never raw tokens) of the
 * current access/refresh tokens. `access_hash`/`refresh_hash` are unique so a
 * presented token maps to at most one session; rotation supersedes the prior
 * hash. Both hashes are nullable so the access slot can be written before the
 * refresh slot during login.
 */
export const authSessionTokensTable = pgTable(
  "auth_session_tokens",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => authSessionsTable.id, { onDelete: "cascade" }),
    accessHash: text("access_hash"),
    refreshHash: text("refresh_hash"),
    context: jsonb("context").$type<StoredAuthContext>(),
    accessExpiresAt: epoch("access_expires_at"),
    refreshExpiresAt: epoch("refresh_expires_at"),
  },
  (t) => ({
    accessUniq: uniqueIndex("auth_session_tokens_access_uniq").on(t.accessHash),
    refreshUniq: uniqueIndex("auth_session_tokens_refresh_uniq").on(t.refreshHash),
  }),
);

/**
 * Verification challenges (email verification, password reset, login OTP,
 * MFA step-up). Codes are stored hashed (`code_hash_ref`); attempts bounded.
 */
export const authVerificationsTable = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => authAccountsTable.id, {
      onDelete: "cascade",
    }),
    channel: text("channel").notNull(),
    destination: text("destination").notNull(),
    purpose: text("purpose").notNull(),
    codeHashRef: text("code_hash_ref").notNull(),
    createdAt: epoch("created_at").notNull(),
    expiresAt: epoch("expires_at").notNull(),
    consumedAt: epoch("consumed_at"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
  },
  (t) => ({
    accountPurposeIdx: index("auth_verifications_account_purpose_idx").on(
      t.accountId,
      t.purpose,
    ),
    expiresIdx: index("auth_verifications_expires_idx").on(t.expiresAt),
  }),
);

/**
 * Shared token-bucket rate-limit state keyed by an arbitrary bucket key
 * (e.g. `login:<ip>`, `reset:email:<value>`). Multi-instance safe.
 */
export const authRateLimitsTable = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  lastRefillMs: epoch("last_refill_ms").notNull(),
});

/**
 * Security/audit event stream. `meta` MUST NOT contain secrets. IP and user
 * agent are stored only as hashes for privacy.
 */
export const authSecurityEventsTable = pgTable(
  "auth_security_events",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => authAccountsTable.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
    meta: jsonb("meta").$type<AuthJsonMap>().notNull().default({}),
    createdAt: epoch("created_at").notNull(),
  },
  (t) => ({
    accountIdx: index("auth_security_events_account_idx").on(t.accountId, t.createdAt),
    typeIdx: index("auth_security_events_type_idx").on(t.type, t.createdAt),
  }),
);

/**
 * Single-use, expiring bootstrap token used to provision the very first owner
 * account. The token secret is stored only as a hash; there is NO default
 * password anywhere in the system.
 */
export const authBootstrapTokensTable = pgTable(
  "auth_bootstrap_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: epoch("expires_at").notNull(),
    consumedAt: epoch("consumed_at"),
    consumedByAccountId: text("consumed_by_account_id").references(
      () => authAccountsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: epoch("created_at").notNull(),
  },
  (t) => ({
    tokenUniq: uniqueIndex("auth_bootstrap_tokens_hash_uniq").on(t.tokenHash),
  }),
);

export type AuthAccount = typeof authAccountsTable.$inferSelect;
export type AuthIdentifier = typeof authIdentifiersTable.$inferSelect;
export type AuthCredential = typeof authCredentialsTable.$inferSelect;
export type AuthSession = typeof authSessionsTable.$inferSelect;
export type AuthSessionToken = typeof authSessionTokensTable.$inferSelect;
export type AuthVerification = typeof authVerificationsTable.$inferSelect;
export type AuthRateLimit = typeof authRateLimitsTable.$inferSelect;
export type AuthSecurityEvent = typeof authSecurityEventsTable.$inferSelect;
export type AuthBootstrapToken = typeof authBootstrapTokensTable.$inferSelect;
