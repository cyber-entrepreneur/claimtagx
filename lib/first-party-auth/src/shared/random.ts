/**
 * Outbound port for CRYPTOGRAPHIC randomness. The core generates OTP codes,
 * TOTP secrets, session/recovery tokens, and OAuth state via this — never via
 * `Math.random()` (which is predictable and would be a security hole). The
 * adapter wraps a CSPRNG (Node `crypto`, WebCrypto, etc.).
 */

export interface SecureRandom {
  /** `n` cryptographically-random bytes. */
  bytes(n: number): Uint8Array;
  /** A uniform integer in `[0, maxExclusive)` without modulo bias. */
  int(maxExclusive: number): number;
}
