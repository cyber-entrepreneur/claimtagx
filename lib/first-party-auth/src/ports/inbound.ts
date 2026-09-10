/**
 * INBOUND (driving) ports for the auth context — the flows the package OFFERS.
 * A driving adapter (REST/GraphQL/gRPC controller, the comms-core server, a
 * CLI, a test) calls these. Every operation returns `Result` so expected auth
 * failures (bad code, MFA required, rate limited) are values, not exceptions.
 */

import type { Result, AuthError } from "../shared/result.js";
import type { AccountId, SessionId, ChallengeId } from "../domain/ids.js";
import type { Account, Identifier } from "../domain/account.js";
import type { SocialProvider, SignatureAlgorithm } from "../domain/credential.js";
import type { AuthContext, TokenPair } from "../domain/session.js";
import type { DeliveryChannel } from "../domain/verification.js";
import type { MfaMethod } from "../domain/mfa.js";

export type AuthResult<T> = Result<T, AuthError>;

/** Optional context about the calling endpoint, used for session binding + throttling. */
export interface RequestContext {
  readonly deviceId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * The outcome of an authentication attempt. A single union so every login path
 * (password, OTP, social) reports uniformly and the caller drives next steps.
 */
export type LoginOutcome =
  | { readonly status: "authenticated"; readonly tokens: TokenPair; readonly context: AuthContext }
  | { readonly status: "mfa_required"; readonly accountId: AccountId; readonly methods: readonly MfaMethod[] }
  | { readonly status: "verification_required"; readonly challengeId: ChallengeId };

// --- Registration & identifier verification ---------------------------------

export interface RegistrationService {
  registerWithPassword(input: {
    readonly identifier: { readonly kind: Identifier["kind"]; readonly value: string };
    readonly password: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<{ account: Account; verification?: ChallengeId }>>;

  /** Begin verifying an identifier by sending a code. */
  startIdentifierVerification(input: {
    readonly accountId: AccountId;
    readonly kind: Identifier["kind"];
    readonly value: string;
    readonly channel: DeliveryChannel;
  }): Promise<AuthResult<{ challengeId: ChallengeId }>>;

  /** Complete verification; marks the identifier verified and account active. */
  confirmIdentifier(input: {
    readonly challengeId: ChallengeId;
    readonly code: string;
  }): Promise<AuthResult<{ account: Account }>>;
}

// --- Authentication (password, OTP, social) ---------------------------------

export interface AuthenticationService {
  loginWithPassword(input: {
    readonly identifier: { readonly kind: Identifier["kind"]; readonly value: string };
    readonly password: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>>;

  /** Passwordless: send a login code to a known identifier. */
  requestLoginOtp(input: {
    readonly identifier: { readonly kind: Identifier["kind"]; readonly value: string };
    readonly channel: DeliveryChannel;
    readonly context?: RequestContext;
  }): Promise<AuthResult<{ challengeId: ChallengeId }>>;

  verifyLoginOtp(input: {
    readonly challengeId: ChallengeId;
    readonly code: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>>;

  /** Second factor after a `mfa_required` first factor. */
  submitMfa(input: {
    readonly accountId: AccountId;
    readonly method: MfaMethod;
    readonly code: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>>;
}

export interface SocialService {
  begin(input: {
    readonly provider: SocialProvider;
    readonly redirectUri: string;
  }): Promise<AuthResult<{ authorizationUrl: string; state: string }>>;

  complete(input: {
    readonly provider: SocialProvider;
    readonly code: string;
    readonly state: string;
    readonly redirectUri: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>>;
}

// --- Password lifecycle ------------------------------------------------------

export interface PasswordService {
  requestReset(input: {
    readonly identifier: { readonly kind: Identifier["kind"]; readonly value: string };
    readonly channel: DeliveryChannel;
  }): Promise<AuthResult<{ challengeId: ChallengeId }>>;

  resetPassword(input: {
    readonly challengeId: ChallengeId;
    readonly code: string;
    readonly newPassword: string;
  }): Promise<AuthResult<void>>;

  changePassword(input: {
    readonly accountId: AccountId;
    readonly currentPassword: string;
    readonly newPassword: string;
  }): Promise<AuthResult<void>>;
}

// --- MFA / TOTP enrollment ---------------------------------------------------

export interface MfaService {
  enrollTotp(input: {
    readonly accountId: AccountId;
    readonly issuer: string;
    readonly label: string;
  }): Promise<AuthResult<{ otpauthUri: string }>>;

  confirmTotp(input: {
    readonly accountId: AccountId;
    readonly code: string;
  }): Promise<AuthResult<void>>;

  /** Returns freshly-generated one-time recovery codes (shown once). */
  generateRecoveryCodes(input: {
    readonly accountId: AccountId;
  }): Promise<AuthResult<{ codes: readonly string[] }>>;

  disable(input: {
    readonly accountId: AccountId;
    readonly method: MfaMethod;
  }): Promise<AuthResult<void>>;
}

// --- Sessions ----------------------------------------------------------------

export interface SessionService {
  /** The core capability downstream services depend on: token → principal. */
  verify(accessToken: string): Promise<AuthResult<AuthContext>>;
  refresh(refreshToken: string): Promise<AuthResult<TokenPair>>;
  revoke(sessionId: SessionId): Promise<AuthResult<void>>;
  revokeAll(accountId: AccountId): Promise<AuthResult<void>>;
}

// --- Anonymous key-based identity (Threema-style; no phone/email required) ----

export interface AnonymousIdentityService {
  /** Create an account whose identity IS a self-generated keypair. Uploads only
   *  the public key (opaque string — base64 by convention) — no identifier/PII.
   *  Returns the new account (+ its id). */
  register(input: {
    readonly algorithm: SignatureAlgorithm;
    readonly publicKey: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<{ account: Account }>>;

  /** Begin challenge-response login: issue a one-time nonce bound to the account.
   *  The nonce is raw bytes; the server edge base64-encodes it for the wire. */
  beginChallenge(input: {
    readonly accountId: AccountId;
    readonly context?: RequestContext;
  }): Promise<AuthResult<{ challengeId: ChallengeId; nonce: Uint8Array }>>;

  /** Complete login: verify the signature over the nonce against the account's
   *  public key, then issue a session. */
  completeChallenge(input: {
    readonly challengeId: ChallengeId;
    readonly signature: Uint8Array;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>>;
}
