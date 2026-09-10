/**
 * Internal helpers shared across the application services. NOT a port —
 * consumed only from within `../application`. Keeping this here avoids
 * duplicating session issuance, MFA-availability, and challenge-consumption
 * logic across every flow service that needs it.
 */

import type { AccountId, DeviceId, SessionId } from "../domain/ids.js";
import type { Account } from "../domain/account.js";
import type { AuthContext, Session, TokenPair } from "../domain/session.js";
import type {
  Credential,
  RecoveryCredential,
  TotpCredential,
} from "../domain/credential.js";
import type { MfaMethod } from "../domain/mfa.js";
import type { VerificationChallenge } from "../domain/verification.js";
import { canAttempt, isChallengeExpired } from "../domain/verification.js";
import type { Clock, EpochMillis, IdGenerator } from "../shared/clock.js";
import { epochMillis } from "../shared/clock.js";
import type { EventPublisher } from "../shared/events.js";
import { domainEvent } from "../shared/events.js";
import type { SecureRandom } from "../shared/random.js";
import { authError, err, ok } from "../shared/result.js";
import { asId } from "../shared/ids.js";
import type { AuthResult, LoginOutcome, RequestContext } from "../ports/inbound.js";
import type { PasswordHasher, SessionRepository, TokenService } from "../ports/outbound.js";

export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Uniform-length numeric one-time code, digit-by-digit via `SecureRandom`. */
export const generateNumericCode = (random: SecureRandom, length: number): string => {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += random.int(10).toString();
  }
  return code;
};

export interface SessionIssuerDeps {
  readonly sessions: SessionRepository;
  readonly tokens: TokenService;
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Creates + persists a Session, mints a TokenPair, and emits the success event. */
export const issueAuthenticatedSession = async (
  deps: SessionIssuerDeps,
  account: Account,
  context: RequestContext | undefined,
  method: string,
): Promise<LoginOutcome> => {
  const now = deps.clock.now();
  const sessionId = asId(deps.ids.next()) as SessionId;
  const accessExpiresAt = epochMillis(now + ACCESS_TTL_MS);
  const refreshExpiresAt = epochMillis(now + REFRESH_TTL_MS);
  const deviceId = context?.deviceId !== undefined ? (asId(context.deviceId) as DeviceId) : undefined;

  const session: Session = {
    id: sessionId,
    accountId: account.id,
    issuedAt: now,
    expiresAt: refreshExpiresAt,
    refreshExpiresAt,
    ...(deviceId !== undefined ? { deviceId } : {}),
  };
  await deps.sessions.save(session);

  const authContext: AuthContext = {
    accountId: account.id,
    sessionId,
    scopes: [],
    ...(deviceId !== undefined ? { deviceId } : {}),
  };

  const accessToken = await deps.tokens.issueAccess(authContext, accessExpiresAt);
  const refreshToken = await deps.tokens.issueRefresh(sessionId, refreshExpiresAt);

  const tokens: TokenPair = {
    accessToken,
    accessExpiresAt,
    refreshToken,
    refreshExpiresAt,
  };

  await deps.events.publish(
    domainEvent("auth.login.succeeded", now, {
      accountId: account.id,
      sessionId,
      method,
    }),
  );

  return { status: "authenticated", tokens, context: authContext };
};

/** Second factors an account can currently satisfy, derived from stored credentials. */
export const availableMfaMethods = (credentials: readonly Credential[]): MfaMethod[] => {
  const methods: MfaMethod[] = [];
  const hasConfirmedTotp = credentials.some(
    (c): c is TotpCredential => c.kind === "totp" && c.confirmedAt !== undefined,
  );
  if (hasConfirmedTotp) {
    methods.push("totp");
  }
  const hasRecoveryCodes = credentials.some(
    (c): c is RecoveryCredential => c.kind === "recovery" && c.codeHashes.length > 0,
  );
  if (hasRecoveryCodes) {
    methods.push("recovery");
  }
  return methods;
};

/** Locked/disabled gate shared by every login-adjacent flow. */
export const assertAccountUsable = (account: Account, now: EpochMillis): AuthResult<void> => {
  if (account.status === "disabled") {
    return err(authError("ACCOUNT_DISABLED", "This account has been disabled."));
  }
  if (account.status === "locked" && (account.lockedUntil === undefined || account.lockedUntil > now)) {
    return err(authError("ACCOUNT_LOCKED", "This account is temporarily locked."));
  }
  return ok(undefined);
};

/**
 * Validates a one-time-code attempt against a challenge: rejects already-consumed,
 * expired, or attempt-exhausted challenges, then verifies the hash. On success
 * returns the challenge with `consumedAt` set and `attempts` incremented, ready to
 * persist. Callers MUST persist the incremented-attempts challenge on failure too
 * (`{ ...challenge, attempts: challenge.attempts + 1 }`) so max-attempts sticks.
 */
export const consumeChallenge = async (
  challenge: VerificationChallenge,
  code: string,
  hasher: PasswordHasher,
  now: EpochMillis,
): Promise<AuthResult<VerificationChallenge>> => {
  if (challenge.consumedAt !== undefined) {
    return err(authError("CODE_INVALID", "This code has already been used."));
  }
  if (isChallengeExpired(challenge, now)) {
    return err(authError("CODE_EXPIRED", "This code has expired."));
  }
  if (!canAttempt(challenge, now)) {
    return err(authError("CODE_MAX_ATTEMPTS", "Too many attempts for this code."));
  }

  const valid = await hasher.verify(code, challenge.codeHashRef);
  if (!valid) {
    return err(authError("CODE_INVALID", "Invalid code."));
  }

  return ok({ ...challenge, consumedAt: now, attempts: challenge.attempts + 1 });
};
