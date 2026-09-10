/**
 * Composition root for @workspace/first-party-auth.
 * The one place allowed to import both application services and adapters.
 */

import type { Clock, IdGenerator } from "./shared/clock.js";
import type { EventPublisher } from "./shared/events.js";
import type { SecureRandom } from "./shared/random.js";
import type {
  AnonymousIdentityService,
  AuthenticationService,
  MfaService,
  PasswordService,
  RegistrationService,
  SessionService,
  SocialService,
} from "./ports/inbound.js";
import type {
  AccountRepository,
  CodeDeliverer,
  CredentialRepository,
  KeyChallengeStore,
  OAuthClient,
  PasswordHasher,
  RateLimiter,
  SessionRepository,
  SignatureVerifier,
  TokenService,
  TotpAuthenticator,
  VerificationRepository,
} from "./ports/outbound.js";
import {
  AnonymousIdentityServiceImpl,
  AuthenticationServiceImpl,
  MfaServiceImpl,
  PasswordServiceImpl,
  RegistrationServiceImpl,
  SessionServiceImpl,
  SocialServiceImpl,
} from "./application/index.js";
import {
  Argon2idPasswordHasher,
  DevJwtTokenService,
  Ed25519SignatureVerifier,
  FakeClock,
  FakeOAuthClient,
  InMemoryAccountRepository,
  InMemoryCredentialRepository,
  InMemoryKeyChallengeStore,
  InMemoryRateLimiter,
  InMemorySessionRepository,
  InMemoryVerificationRepository,
  NodeSecureRandom,
  RecordingCodeDeliverer,
  RecordingEventPublisher,
  Rfc6238TotpAuthenticator,
  SequentialIdGenerator,
} from "./adapters/index.js";

export interface AuthPlatform {
  readonly registration: RegistrationService;
  readonly authentication: AuthenticationService;
  readonly social: SocialService;
  readonly password: PasswordService;
  readonly mfa: MfaService;
  readonly sessions: SessionService;
  readonly anonymous: AnonymousIdentityService;
  /** Exposed so hosts/tests can read delivered codes in dev. */
  readonly deliverer: CodeDeliverer;
}

export interface AuthPlatformConfig {
  readonly accounts?: AccountRepository;
  readonly credentials?: CredentialRepository;
  readonly sessions?: SessionRepository;
  readonly verifications?: VerificationRepository;
  readonly hasher?: PasswordHasher;
  readonly totp?: TotpAuthenticator;
  readonly deliverer?: CodeDeliverer;
  readonly tokens?: TokenService;
  readonly oauth?: OAuthClient;
  readonly rateLimiter?: RateLimiter;
  readonly random?: SecureRandom;
  readonly events?: EventPublisher;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly signatureVerifier?: SignatureVerifier;
  readonly keyChallenges?: KeyChallengeStore;
  /** HS256 secret for DevJwt when `tokens` is omitted. */
  readonly jwtSecret?: string;
  readonly rateLimitCapacity?: number;
  readonly rateLimitRefillPerMs?: number;
}

export function createAuthPlatform(config: AuthPlatformConfig = {}): AuthPlatform {
  const clock = config.clock ?? new FakeClock(1_700_000_000_000);
  const ids = config.ids ?? new SequentialIdGenerator("auth");
  const random = config.random ?? new NodeSecureRandom();
  const events = config.events ?? new RecordingEventPublisher();
  const accounts = config.accounts ?? new InMemoryAccountRepository();
  const credentials = config.credentials ?? new InMemoryCredentialRepository();
  const sessions = config.sessions ?? new InMemorySessionRepository();
  const verifications = config.verifications ?? new InMemoryVerificationRepository();
  // Production-grade default: Argon2id. Callers may inject any `PasswordHasher`.
  const hasher = config.hasher ?? new Argon2idPasswordHasher();
  // NOTE: `Rfc6238TotpAuthenticator` keeps secrets in a process-local Map — fine
  // for tests/local dev only. Production compositions MUST inject
  // `EncryptedTotpAuthenticator` (self-contained AES-256-GCM secret blobs).
  const totp = config.totp ?? new Rfc6238TotpAuthenticator(random);
  const deliverer = config.deliverer ?? new RecordingCodeDeliverer();
  // NOTE: `DevJwtTokenService` is a self-contained HS256 signer for in-memory
  // tests. Production compositions MUST inject `OpaqueTokenService` (opaque
  // tokens with only hashes persisted via an `OpaqueTokenRepository`).
  const tokens =
    config.tokens ??
    new DevJwtTokenService(config.jwtSecret ?? "dev-only-change-me", clock);
  const oauth = config.oauth ?? new FakeOAuthClient();
  const rateLimiter =
    config.rateLimiter ??
    new InMemoryRateLimiter({
      capacity: config.rateLimitCapacity ?? 20,
      refillPerMs: config.rateLimitRefillPerMs ?? 1 / 1000,
      clock,
    });

  const registration = new RegistrationServiceImpl({
    accounts,
    credentials,
    verifications,
    hasher,
    deliverer,
    random,
    events,
    clock,
    ids,
  });
  const authentication = new AuthenticationServiceImpl({
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
  const social = new SocialServiceImpl({
    accounts,
    credentials,
    sessions,
    tokens,
    oauth,
    random,
    events,
    clock,
    ids,
  });
  const password = new PasswordServiceImpl({
    accounts,
    credentials,
    verifications,
    hasher,
    deliverer,
    rateLimiter,
    random,
    events,
    clock,
    ids,
  });
  const mfa = new MfaServiceImpl({
    accounts,
    credentials,
    totp,
    hasher,
    random,
    events,
    clock,
    ids,
  });
  const sessionService = new SessionServiceImpl({
    sessions,
    tokens,
    events,
    clock,
    ids,
  });
  const anonymous = new AnonymousIdentityServiceImpl({
    accounts,
    credentials,
    challenges: config.keyChallenges ?? new InMemoryKeyChallengeStore(),
    verifier: config.signatureVerifier ?? new Ed25519SignatureVerifier(),
    rateLimiter,
    random,
    sessions,
    tokens,
    events,
    clock,
    ids,
  });

  return {
    registration,
    authentication,
    social,
    password,
    mfa,
    sessions: sessionService,
    anonymous,
    deliverer,
  };
}
