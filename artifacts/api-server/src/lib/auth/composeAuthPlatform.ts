/**
 * Production composition root for ClaimTagX first-party auth.
 *
 * This is the ONE place in the API server allowed to wire the vendored
 * `@workspace/first-party-auth` application services to concrete infrastructure
 * adapters. It builds a fully durable, multi-instance-safe platform:
 *
 *   - PostgreSQL adapters (accounts, credentials, sessions, verifications,
 *     opaque token store, token-bucket rate limiter) over the shared
 *     `@workspace/db` drizzle connection.
 *   - Argon2id password hashing (OWASP params, env-tunable).
 *   - AES-256-GCM `EncryptedTotpAuthenticator` for MFA (self-contained sealed
 *     secrets; no server-side secret store).
 *   - Opaque access/refresh tokens (only SHA-256 hashes persisted).
 *   - A Microsoft Graph-backed `CodeDeliverer` that sends auth mail directly and
 *     NEVER writes the plaintext code to a durable job/audit record.
 *   - A `SecurityEventPublisher` that appends secret-free events to
 *     `auth_security_events`.
 *
 * Production compositions NEVER use `RecordingCodeDeliverer`, `DevJwtTokenService`,
 * `InMemoryRateLimiter`, `Rfc6238TotpAuthenticator`, or any in-memory repository.
 *
 * The session cookie (`ctx_auth_session`) carries the OPAQUE REFRESH TOKEN. The
 * resolver verifies it against the durable token store (hash lookup), loads the
 * session, and rejects revoked/expired sessions — without rotating on every
 * request. Rotation happens explicitly on login / MFA / password change.
 */
import { randomUUID, createHash } from "node:crypto";
import type { Response } from "express";
import {
  AuthDomain,
  Argon2idPasswordHasher,
  EncryptedTotpAuthenticator,
  NodeSecureRandom,
  OpaqueTokenService,
  PostgresAccountRepository,
  PostgresCredentialRepository,
  PostgresOpaqueTokenRepository,
  PostgresRateLimiter,
  PostgresSessionRepository,
  PostgresVerificationRepository,
  createAuthPlatform,
  hashToken,
  type AuthPlatform,
  type CodeDeliverer,
} from "@workspace/first-party-auth";
import type {
  Clock,
  DomainEvent,
  EpochMillis,
  EventPublisher,
  IdGenerator,
  SecureRandom,
} from "@workspace/first-party-auth/shared";
import type { AuthDatabase } from "@workspace/first-party-auth";
import { db, authSecurityEventsTable, authIdentifiersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sendTransactionalEmail } from "../email";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

/**
 * Single first-party session cookie shared by CRM (Platform Admin) and Handler.
 * HttpOnly + Secure + SameSite=None in production so the SPA(s) on a different
 * origin can send it cross-site; path=/ so it applies to the whole API. In
 * non-production we relax to SameSite=Lax over http for local dev. CSRF is
 * enforced by an Origin allow-list check in `app.ts` for cookie-bearing writes.
 */
export const AUTH_SESSION_COOKIE = "ctx_auth_session";

const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30d (refresh TTL)

export function authCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "none" | "lax";
  path: "/";
  maxAge: number;
} {
  const prod = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: prod,
    // SameSite=None requires Secure; only valid in production over https.
    sameSite: prod ? "none" : "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  };
}

export function setAuthSessionCookie(res: Response, refreshToken: string): void {
  res.cookie(AUTH_SESSION_COOKIE, refreshToken, authCookieOptions());
}

export function clearAuthSessionCookie(res: Response): void {
  res.clearCookie(AUTH_SESSION_COOKIE, { path: "/" });
}

// ---------------------------------------------------------------------------
// Infrastructure primitives
// ---------------------------------------------------------------------------

class SystemClock implements Clock {
  now(): EpochMillis {
    return Date.now() as EpochMillis;
  }
}

class UuidIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

/** Best-effort, secret-free hash used for ip/user-agent columns. */
function privacyHash(value: string | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("base64url").slice(0, 43);
}

/**
 * Durable audit sink → `auth_security_events`. Domain events carry only ids and
 * references (never passwords/tokens/codes), so `meta` is safe to persist.
 * `accountId` is lifted out of the payload when present.
 */
class SecurityEventPublisher implements EventPublisher {
  async publish(event: DomainEvent): Promise<void> {
    try {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const accountId =
        typeof payload.accountId === "string" ? payload.accountId : null;
      const meta: Record<string, unknown> = { ...payload };
      delete meta.accountId;
      await db.insert(authSecurityEventsTable).values({
        id: randomUUID(),
        accountId,
        type: event.type,
        ipHash: null,
        userAgentHash: null,
        meta,
        createdAt: event.occurredAt,
      });
    } catch (err) {
      // Auditing must never block an auth flow.
      logger.error({ err, type: event.type }, "auth security event write failed");
    }
  }
}

/**
 * Microsoft Graph-backed code deliverer for auth mail (invite / verify / reset /
 * login OTP).
 *
 * DELIVERY SECRECY CHOICE (documented per task):
 *   The one-time code is delivered by sending the email IMMEDIATELY via the
 *   existing Graph transactional-email path. We do NOT enqueue a durable CRM
 *   job/effect carrying the plaintext code, and we do NOT log the code. The
 *   code's HASH is already persisted by the auth core's `VerificationRepository`
 *   (auth_verifications.code_hash_ref); only that hash is durable. The audit
 *   trail (`auth_security_events`, via the platform `EventPublisher`) records
 *   the challenge id + purpose + a destination hash — never the code itself.
 *   This keeps a single, secret-free durable record while still delivering the
 *   plaintext exactly once. (An encrypted-payload worker hand-off — see
 *   AUTH_DELIVERY_ENCRYPTION_KEY in the env inventory — was considered but is
 *   unnecessary given direct send has no durable secret surface.)
 */
class GraphCodeDeliverer implements CodeDeliverer {
  async deliver(params: {
    channel: "sms" | "email";
    destination: string;
    code: string;
    purpose: "identifier_verify" | "login_otp" | "password_reset" | "mfa_step_up";
    challengeId?: string;
  }): Promise<void> {
    if (params.channel !== "email") {
      // SMS is not provisioned for staff/handler auth. Fail soft so callers get
      // a generic outcome rather than an infra exception.
      logger.warn({ purpose: params.purpose }, "auth code delivery skipped: sms channel not configured");
      return;
    }
    const { subject, intro } = describePurpose(params.purpose);
    const code = params.code;
    const siteBase = (process.env.VITE_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
    const resetLink =
      params.purpose === "password_reset" && params.challengeId && siteBase
        ? `${siteBase}/admin?mode=reset&token=${encodeURIComponent(`${params.challengeId}.${code}`)}`
        : null;
    const text = [
      intro,
      "",
      resetLink
        ? `Open this link to choose a new password:\n${resetLink}\n\nOr enter this code: ${code}`
        : `Your code is: ${code}`,
      "",
      "This code expires shortly. If you did not request it, you can ignore this email.",
    ].join("\n");
    const html = `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0b1220">
        <p style="font-size:14px;line-height:1.5;margin:0 0 12px">${escapeHtml(intro)}</p>
        ${
          resetLink
            ? `<p style="margin:16px 0"><a href="${escapeHtml(resetLink)}" style="display:inline-block;background:#0b1220;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:14px">Reset password</a></p>
               <p style="font-size:12px;color:#475569;line-height:1.5;margin:0 0 12px">Or enter this code: <strong>${escapeHtml(code)}</strong></p>`
            : `<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${escapeHtml(code)}</p>`
        }
        <p style="font-size:12px;color:#475569;line-height:1.5;margin:0">This code expires shortly. If you did not request it, you can ignore this email.</p>
      </div>`;
    // Never pass the code as an idempotency key or log it.
    await sendTransactionalEmail({ to: params.destination, subject, text, html });
  }
}

function describePurpose(
  purpose: "identifier_verify" | "login_otp" | "password_reset" | "mfa_step_up",
): { subject: string; intro: string } {
  switch (purpose) {
    case "identifier_verify":
      return {
        subject: "Verify your ClaimTagX email",
        intro: "Use this code to verify your ClaimTagX email address.",
      };
    case "login_otp":
      return {
        subject: "Your ClaimTagX sign-in code",
        intro: "Use this code to finish signing in to ClaimTagX.",
      };
    case "password_reset":
      return {
        subject: "Reset your ClaimTagX password",
        intro: "Use this code to reset your ClaimTagX password.",
      };
    case "mfa_step_up":
      return {
        subject: "ClaimTagX verification code",
        intro: "Use this code to confirm it's you.",
      };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Argon2id / MFA key configuration
// ---------------------------------------------------------------------------

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function argon2Params(): { memoryCost: number; timeCost: number; parallelism: number } {
  // OWASP Argon2id minimums as secure defaults; tunable per deployment.
  return {
    memoryCost: positiveIntEnv("AUTH_ARGON2_MEMORY_KIB", 19_456),
    timeCost: positiveIntEnv("AUTH_ARGON2_TIME_COST", 2),
    parallelism: positiveIntEnv("AUTH_ARGON2_PARALLELISM", 1),
  };
}

function mfaEncryptionKey(random: SecureRandom): string {
  const configured = process.env.AUTH_MFA_ENCRYPTION_KEY?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_MFA_ENCRYPTION_KEY is required in production (32-byte base64/base64url/hex key for MFA secret encryption).",
    );
  }
  // Dev only: ephemeral key so local TOTP works within a single process.
  const ephemeral = Buffer.from(random.bytes(32)).toString("base64");
  logger.warn("AUTH_MFA_ENCRYPTION_KEY not set; using an ephemeral dev key (TOTP secrets will not survive restart)");
  return ephemeral;
}

// ---------------------------------------------------------------------------
// Composed service
// ---------------------------------------------------------------------------

export interface ResolvedSession {
  readonly accountId: string;
  readonly sessionId: string;
}

export interface RequestContextInput {
  readonly deviceId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface ProvisionResult {
  readonly ok: boolean;
  readonly accountId?: string;
  readonly error?: string;
}

export interface AuthService {
  readonly platform: AuthPlatform;
  readonly issuer: string;
  /** Resolve a session cookie/bearer value (opaque refresh token) → principal. */
  resolveSessionToken(token: string): Promise<ResolvedSession | null>;
  /** Verify a short-lived opaque ACCESS token (bearer) → principal. */
  resolveAccessToken(token: string): Promise<ResolvedSession | null>;
  /** Revoke the session behind an opaque refresh token and drop its tokens. */
  revokeSessionToken(token: string): Promise<void>;
  /** Revoke a single session by id (must belong to `accountId`). */
  revokeSessionForAccount(accountId: string, sessionId: string): Promise<boolean>;
  /** Revoke every session for an account. */
  revokeAllForAccount(accountId: string): Promise<void>;
  /** List active (non-revoked, unexpired) sessions for an account. */
  listActiveSessions(accountId: string): Promise<ReadonlyArray<{
    id: string;
    deviceId?: string;
    issuedAt: number;
    expiresAt: number;
  }>>;
  /**
   * Directly mint a durable session (+ opaque refresh token) for an account
   * WITHOUT a password round-trip. Used only after the caller has already
   * proven control of the account (bootstrap / invite acceptance / non-prod
   * test login). Returns the plaintext refresh token for the session cookie.
   */
  issueSessionForAccount(
    accountId: string,
    context?: RequestContextInput,
  ): Promise<{ refreshToken: string; sessionId: string }>;
  /** Mint a refresh token for an existing session id (cookie fallback). */
  mintRefreshForSession(sessionId: string): Promise<string>;
  /** The verified email identifier for an account, if any. */
  getAccountEmail(accountId: string): Promise<string | undefined>;
  /**
   * Provision an ACTIVE account with a verified email + password in one step
   * (used by bootstrap and invite acceptance). Bypasses email OTP because the
   * caller already proved control of the invitation/bootstrap token.
   */
  provisionAccount(input: {
    email: string;
    password: string;
  }): Promise<ProvisionResult>;
}

let cached: AuthService | undefined;

/** Lazily builds (and memoizes) the production auth platform. */
export function getAuthService(): AuthService {
  if (cached) return cached;

  if (process.env.NODE_ENV === "production") {
    // Fail closed: production must never compose development/simulator adapters.
    const forbidden = [
      process.env.CRM_HTTP_TEST_AUTH,
      process.env.AUTH_ALLOW_DEV_JWT,
      process.env.AUTH_USE_IN_MEMORY,
    ];
    if (forbidden.some((v) => v === "1" || v === "true")) {
      throw new Error(
        "Production auth composition refused: development auth bypass flags are set.",
      );
    }
    const graphTenant = process.env.MS_GRAPH_TENANT_ID?.trim();
    const graphClient = process.env.MS_GRAPH_CLIENT_ID?.trim();
    const graphSecret =
      process.env.MS_GRAPH_CLIENT_SECRET?.trim() ||
      process.env.MS_GRAPH_CLIENT_CERTIFICATE?.trim();
    if (!graphTenant || !graphClient || !graphSecret) {
      throw new Error(
        "Production auth composition refused: Microsoft Graph mail credentials are required for verification/invitation/reset delivery.",
      );
    }
  }

  const authDb = db as unknown as AuthDatabase;
  const clock = new SystemClock();
  const ids = new UuidIdGenerator();
  const random: SecureRandom = new NodeSecureRandom();

  const accounts = new PostgresAccountRepository(authDb);
  const credentials = new PostgresCredentialRepository(authDb);
  const sessions = new PostgresSessionRepository(authDb);
  const verifications = new PostgresVerificationRepository(authDb);
  const tokenRepository = new PostgresOpaqueTokenRepository(authDb);
  const tokens = new OpaqueTokenService(tokenRepository, random, clock);
  const hasher = new Argon2idPasswordHasher(argon2Params());
  const totp = EncryptedTotpAuthenticator.fromEncodedKey({
    encodedKey: mfaEncryptionKey(random),
    random,
  });
  const rateLimiter = new PostgresRateLimiter(authDb, {
    // ~20 attempts, refill 1 token/sec — shared across all API instances.
    capacity: 20,
    refillPerMs: 1 / 1000,
    clock,
  });
  const events = new SecurityEventPublisher();
  const deliverer = new GraphCodeDeliverer();

  const platform = createAuthPlatform({
    accounts,
    credentials,
    sessions,
    verifications,
    hasher,
    totp,
    deliverer,
    tokens,
    rateLimiter,
    random,
    events,
    clock,
    ids,
  });

  const issuer = "ClaimTagX";

  const service: AuthService = {
    platform,
    issuer,

    async resolveSessionToken(token) {
      if (!token) return null;
      const sessionId = await tokens.verifyRefresh(token);
      if (sessionId === null) return null;
      const session = await sessions.findById(sessionId);
      if (session === undefined) return null;
      if (session.revokedAt !== undefined) return null;
      if (session.expiresAt <= clock.now()) return null;
      return { accountId: session.accountId, sessionId: session.id };
    },

    async resolveAccessToken(token) {
      if (!token) return null;
      const result = await platform.sessions.verify(token);
      if (!result.ok) return null;
      return { accountId: result.value.accountId, sessionId: result.value.sessionId };
    },

    async revokeSessionToken(token) {
      if (!token) return;
      const sessionId = await tokens.verifyRefresh(token);
      if (sessionId === null) return;
      await platform.sessions.revoke(sessionId as never);
      await tokenRepository.revoke(sessionId);
    },

    async revokeSessionForAccount(accountId, sessionId) {
      const session = await sessions.findById(sessionId as never);
      if (session === undefined || session.accountId !== accountId) return false;
      await platform.sessions.revoke(sessionId as never);
      await tokenRepository.revoke(sessionId as never);
      return true;
    },

    async revokeAllForAccount(accountId) {
      await platform.sessions.revokeAll(accountId as never);
    },

    async listActiveSessions(accountId) {
      const now = clock.now();
      const rows = await sessions.listForAccount(accountId as never);
      return rows
        .filter((s) => s.revokedAt === undefined && s.expiresAt > now)
        .map((s) => ({
          id: s.id as string,
          deviceId: s.deviceId as string | undefined,
          issuedAt: s.issuedAt as number,
          expiresAt: s.expiresAt as number,
        }));
    },

    async issueSessionForAccount(accountId, context) {
      const now = clock.now();
      const sessionId = ids.next();
      const refreshExpiresAt = (now + SESSION_COOKIE_MAX_AGE_MS) as EpochMillis;
      await sessions.save({
        id: sessionId as never,
        accountId: accountId as never,
        deviceId: context?.deviceId as never,
        issuedAt: now,
        expiresAt: refreshExpiresAt,
        refreshExpiresAt,
      });
      const refreshToken = await tokens.issueRefresh(
        sessionId as never,
        refreshExpiresAt,
      );
      return { refreshToken, sessionId };
    },

    async mintRefreshForSession(sessionId) {
      const now = clock.now();
      const refreshExpiresAt = (now + SESSION_COOKIE_MAX_AGE_MS) as EpochMillis;
      return tokens.issueRefresh(sessionId as never, refreshExpiresAt);
    },

    async getAccountEmail(accountId) {
      const rows = await db
        .select({ value: authIdentifiersTable.value })
        .from(authIdentifiersTable)
        .where(
          and(
            eq(authIdentifiersTable.accountId, accountId),
            eq(authIdentifiersTable.kind, "email"),
          ),
        )
        .limit(1);
      return rows[0]?.value;
    },

    async provisionAccount(input) {
      const normalized = AuthDomain.normalizeIdentifier("email", input.email);
      if (!normalized || !normalized.includes("@")) {
        return { ok: false, error: "A valid email is required." };
      }
      if (!AuthDomain.isPasswordAcceptable(input.password, STAFF_PASSWORD_POLICY)) {
        return {
          ok: false,
          error: AuthDomain.describePasswordPolicy(STAFF_PASSWORD_POLICY),
        };
      }
      const existing = await accounts.findByIdentifier("email", normalized);
      if (existing !== undefined) {
        return { ok: false, error: "This email is already registered." };
      }
      const now = clock.now();
      const accountId = ids.next();
      await accounts.save({
        id: accountId as never,
        identifiers: [{ kind: "email", value: normalized, verified: true }],
        status: "active",
        mfaRequired: false,
        createdAt: now,
      });
      const hashRef = await hasher.hash(input.password);
      await credentials.save({
        id: ids.next() as never,
        accountId: accountId as never,
        kind: "password",
        hashRef,
        createdAt: now,
        updatedAt: now,
      });
      await events.publish({
        type: "auth.account.provisioned",
        occurredAt: now,
        payload: { accountId },
      });
      return { ok: true, accountId };
    },
  };

  cached = service;
  return service;
}

/** Stronger-than-default password policy for privileged (staff/handler) accounts. */
export const STAFF_PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 1024,
  requireLowercase: true,
  requireUppercase: true,
  requireDigit: true,
} as const;

/** Test-only reset of the memoized platform (used by unit tests). */
export function __resetAuthServiceForTests(): void {
  cached = undefined;
}

/** Stable, non-reversible hash of a bootstrap/opaque secret for DB comparison. */
export function bootstrapTokenHash(token: string): string {
  return hashToken(token);
}
