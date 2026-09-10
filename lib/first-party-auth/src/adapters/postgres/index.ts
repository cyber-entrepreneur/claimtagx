/**
 * PostgreSQL adapters for the first-party auth ports. Every adapter accepts an
 * injected driver-agnostic drizzle `db` plus (optionally) a `tables` object, so
 * ClaimTagX owns the schema (see `./schema.ts`). Nothing here imports a concrete
 * Postgres driver.
 */
export type { AuthDatabase } from "./database.js";
export {
  authAccounts,
  authIdentifiers,
  authCredentials,
  authSessions,
  authVerifications,
  authKeyChallenges,
  authSessionTokens,
  authRateLimits,
  authAuditEvents,
  authSchema,
  type AuthSchema,
} from "./schema.js";

export {
  PostgresAccountRepository,
  type AccountTables,
} from "./postgres-account-repository.js";
export {
  PostgresCredentialRepository,
  type CredentialTables,
} from "./postgres-credential-repository.js";
export {
  PostgresSessionRepository,
  type SessionTables,
} from "./postgres-session-repository.js";
export {
  PostgresVerificationRepository,
  type VerificationTables,
} from "./postgres-verification-repository.js";
export {
  PostgresKeyChallengeStore,
  type KeyChallengeTables,
} from "./postgres-key-challenge-store.js";
export {
  PostgresOpaqueTokenRepository,
  type OpaqueTokenTables,
} from "./postgres-opaque-token-repository.js";
export {
  PostgresRateLimiter,
  type PostgresRateLimiterOptions,
  type RateLimitTables,
} from "./postgres-rate-limiter.js";
export {
  PostgresAuditEventWriter,
  type PostgresAuditEventWriterOptions,
  type AuditEventTables,
} from "./postgres-audit-event-writer.js";
