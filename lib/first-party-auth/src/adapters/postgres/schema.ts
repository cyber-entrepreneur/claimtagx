/**
 * Canonical Drizzle schema for the first-party auth Postgres adapters.
 *
 * ClaimTagX OWNS this schema: the tables are declared here (not vendored from
 * any upstream), prefixed `auth_`, and intended to be applied via additive
 * migrations after the existing `0020` migration. Every adapter accepts a
 * `tables` object so a host may substitute its own compatibly-shaped tables,
 * but these definitions are the reference contract.
 *
 * Epoch columns store `EpochMillis` as `bigint` in `number` mode — the domain
 * models time as milliseconds-since-epoch, well within the safe integer range.
 * Byte payloads (e.g. anonymous-login nonces) are stored base64-encoded in
 * `text` columns so the schema stays driver-agnostic.
 */
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

const epoch = (name: string) => bigint(name, { mode: "number" });

export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  mfaRequired: boolean("mfa_required").notNull(),
  createdAt: epoch("created_at").notNull(),
  lockedUntil: epoch("locked_until"),
});

export const authIdentifiers = pgTable(
  "auth_identifiers",
  {
    accountId: text("account_id").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    verified: boolean("verified").notNull(),
  },
  (table) => ({
    // Globally unique login handles (matches migration 0021).
    pk: primaryKey({ columns: [table.kind, table.value] }),
  }),
);

export const authCredentials = pgTable("auth_credentials", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  kind: text("kind").notNull(),
  createdAt: epoch("created_at").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
});

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  deviceId: text("device_id"),
  issuedAt: epoch("issued_at").notNull(),
  expiresAt: epoch("expires_at").notNull(),
  refreshExpiresAt: epoch("refresh_expires_at"),
  revokedAt: epoch("revoked_at"),
});

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  accountId: text("account_id"),
  channel: text("channel").notNull(),
  destination: text("destination").notNull(),
  purpose: text("purpose").notNull(),
  codeHashRef: text("code_hash_ref").notNull(),
  createdAt: epoch("created_at").notNull(),
  expiresAt: epoch("expires_at").notNull(),
  consumedAt: epoch("consumed_at"),
  attempts: integer("attempts").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
});

export const authKeyChallenges = pgTable("auth_key_challenges", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  /** Base64-encoded nonce bytes. */
  nonce: text("nonce").notNull(),
  createdAt: epoch("created_at").notNull(),
  expiresAt: epoch("expires_at").notNull(),
  consumedAt: epoch("consumed_at"),
});

interface StoredAuthContext {
  readonly accountId: string;
  readonly sessionId: string;
  readonly deviceId?: string;
  readonly scopes: readonly string[];
}

export const authSessionTokens = pgTable("auth_session_tokens", {
  sessionId: text("session_id").primaryKey(),
  accessHash: text("access_hash").unique(),
  refreshHash: text("refresh_hash").unique(),
  context: jsonb("context").$type<StoredAuthContext>(),
  accessExpiresAt: epoch("access_expires_at"),
  refreshExpiresAt: epoch("refresh_expires_at"),
});

export const authRateLimits = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  lastRefillMs: epoch("last_refill_ms").notNull(),
});

export const authAuditEvents = pgTable("auth_audit_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  occurredAt: epoch("occurred_at").notNull(),
  accountId: text("account_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

/** The full auth table set, for hosts that want to register the whole schema. */
export const authSchema = {
  authAccounts,
  authIdentifiers,
  authCredentials,
  authSessions,
  authVerifications,
  authKeyChallenges,
  authSessionTokens,
  authRateLimits,
  authAuditEvents,
} as const;

export type AuthSchema = typeof authSchema;
