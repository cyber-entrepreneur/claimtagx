export { InMemoryAccountRepository } from "./in-memory-account-repository.js";
export { InMemoryCredentialRepository } from "./in-memory-credential-repository.js";
export { InMemorySessionRepository } from "./in-memory-session-repository.js";
export { InMemoryVerificationRepository } from "./in-memory-verification-repository.js";
export { ScryptPasswordHasher } from "./scrypt-password-hasher.js";
export {
  Argon2idPasswordHasher,
  DEFAULT_ARGON2ID_PARAMS,
  type Argon2idParams,
} from "./argon2id-password-hasher.js";
export { Rfc6238TotpAuthenticator } from "./rfc6238-totp-authenticator.js";
export {
  EncryptedTotpAuthenticator,
  decodeMfaEncryptionKey,
} from "./encrypted-totp-authenticator.js";
export {
  RecordingCodeDeliverer,
  type RecordedCode,
} from "./recording-code-deliverer.js";
export { DevJwtTokenService } from "./dev-jwt-token-service.js";
export {
  OpaqueTokenService,
  InMemoryOpaqueTokenRepository,
  hashToken,
  type OpaqueTokenRepository,
  type OpaqueAccessRecord,
  type OpaqueRefreshRecord,
} from "./opaque-token-service.js";
export { FakeOAuthClient } from "./fake-oauth-client.js";
export {
  InMemoryRateLimiter,
  type InMemoryRateLimiterOptions,
} from "./in-memory-rate-limiter.js";
export { NodeSecureRandom } from "./node-secure-random.js";
export {
  FakeClock,
  SequentialIdGenerator,
  RecordingEventPublisher,
} from "./test-fakes.js";

export { Ed25519SignatureVerifier } from "./ed25519-signature-verifier.js";
export { InMemoryKeyChallengeStore } from "./in-memory-key-challenge-store.js";

// PostgreSQL adapters (durable, multi-instance production storage).
export * from "./postgres/index.js";
