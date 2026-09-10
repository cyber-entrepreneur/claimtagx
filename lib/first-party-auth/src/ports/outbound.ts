/**
 * OUTBOUND (driven) ports for the auth context. The core defines them;
 * infrastructure adapters implement them. Nothing here names a concrete DB,
 * hashing library, SMS/email vendor, JWT library, or OAuth provider — swapping
 * any adapter must never touch the domain or application layers.
 */

import type { EpochMillis } from "../shared/clock.js";
import type { AccountId, CredentialId, SessionId, ChallengeId } from "../domain/ids.js";
import type { Account, Identifier } from "../domain/account.js";
import type { Credential, CredentialKind, SocialProvider, SignatureAlgorithm } from "../domain/credential.js";
import type { Session, AuthContext } from "../domain/session.js";
import type { VerificationChallenge, DeliveryChannel, ChallengePurpose } from "../domain/verification.js";

// --- Persistence -------------------------------------------------------------

export interface AccountRepository {
  save(account: Account): Promise<void>;
  findById(id: AccountId): Promise<Account | undefined>;
  findByIdentifier(kind: Identifier["kind"], value: string): Promise<Account | undefined>;
}

export interface CredentialRepository {
  save(credential: Credential): Promise<void>;
  findById(id: CredentialId): Promise<Credential | undefined>;
  listForAccount(accountId: AccountId): Promise<readonly Credential[]>;
  findByKind(accountId: AccountId, kind: CredentialKind): Promise<Credential | undefined>;
  /** Look up a social credential by provider + subject during social login. */
  findBySocialSubject(provider: SocialProvider, subject: string): Promise<Credential | undefined>;
  delete(id: CredentialId): Promise<void>;
}

export interface SessionRepository {
  save(session: Session): Promise<void>;
  findById(id: SessionId): Promise<Session | undefined>;
  listForAccount(accountId: AccountId): Promise<readonly Session[]>;
}

export interface VerificationRepository {
  save(challenge: VerificationChallenge): Promise<void>;
  findById(id: ChallengeId): Promise<VerificationChallenge | undefined>;
}

// --- Security primitives (the crypto the core must not do itself) -----------

/** Password hashing/verification. Adapter wraps argon2id/bcrypt/scrypt. */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hashRef: string): Promise<boolean>;
  /** True when `hashRef` uses outdated params and should be re-hashed on login. */
  needsRehash(hashRef: string): boolean;
}

/** Opaque handle to a stored TOTP secret plus the enrollment URI. */
export interface TotpEnrollment {
  readonly secretRef: string;
  /** `otpauth://` URI for QR display. `issuer`/`label` are supplied by the
   *  caller (host-owned, brand-neutral here) — never hard-coded. */
  readonly otpauthUri: string;
}

/** RFC 6238 TOTP. Secret generation, URI building, and code verification. */
export interface TotpAuthenticator {
  enroll(params: { readonly issuer: string; readonly label: string }): Promise<TotpEnrollment>;
  verify(secretRef: string, code: string, now: EpochMillis): Promise<boolean>;
}

/** Delivers a one-time code to a destination. Adapter = Twilio/SES/etc. */
export interface CodeDeliverer {
  deliver(params: {
    readonly channel: DeliveryChannel;
    readonly destination: string;
    readonly code: string;
    readonly purpose: ChallengePurpose;
    /** Optional challenge id so email adapters can build deep links. */
    readonly challengeId?: string;
  }): Promise<void>;
}

/** Mints and verifies access/refresh tokens. Adapter = JWT or opaque store. */
export interface TokenService {
  issueAccess(context: AuthContext, expiresAt: EpochMillis): Promise<string>;
  issueRefresh(sessionId: SessionId, expiresAt: EpochMillis): Promise<string>;
  verifyAccess(token: string): Promise<AuthContext | null>;
  /** Returns the session id a refresh token belongs to, or null if invalid. */
  verifyRefresh(token: string): Promise<SessionId | null>;
}

// --- Social identity ---------------------------------------------------------

export interface SocialProfile {
  readonly provider: SocialProvider;
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly displayName?: string;
}

/** OAuth2/OIDC client. Adapter per provider or one multi-provider adapter. */
export interface OAuthClient {
  authorizationUrl(params: {
    readonly provider: SocialProvider;
    readonly state: string;
    readonly redirectUri: string;
  }): string;
  exchangeCode(params: {
    readonly provider: SocialProvider;
    readonly code: string;
    readonly redirectUri: string;
  }): Promise<SocialProfile>;
}

// --- Abuse prevention --------------------------------------------------------

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs?: number;
}

/** Throttles by an opaque key (e.g. `login:<ip>`, `otp:<accountId>`). */
export interface RateLimiter {
  hit(key: string): Promise<RateLimitDecision>;
  reset(key: string): Promise<void>;
}

// --- Anonymous key-based identity (Threema-style) ----------------------------

/** Verifies a detached signature against a public key. Adapter = Ed25519 (WebCrypto/Node). */
export interface SignatureVerifier {
  verify(input: {
    readonly algorithm: SignatureAlgorithm;
    readonly publicKey: string;
    readonly message: Uint8Array;
    readonly signature: Uint8Array;
  }): Promise<boolean>;
}

/** One-time login nonce for challenge-response over an identity key. */
export interface KeyChallenge {
  readonly id: ChallengeId;
  readonly accountId: AccountId;
  readonly nonce: Uint8Array;
  readonly createdAt: EpochMillis;
  readonly expiresAt: EpochMillis;
  readonly consumedAt?: EpochMillis;
}

export interface KeyChallengeStore {
  save(challenge: KeyChallenge): Promise<void>;
  findById(id: ChallengeId): Promise<KeyChallenge | undefined>;
}
