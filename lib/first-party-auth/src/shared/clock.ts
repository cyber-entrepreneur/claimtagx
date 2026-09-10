/**
 * Time and identity/randomness generation are OUTBOUND PORTS, never ambient
 * globals — critical for auth, where code expiry, token lifetimes, and secret
 * generation must be deterministic under test and injectable in production.
 */

export type EpochMillis = number & { readonly __unit: "EpochMillis" };
export const epochMillis = (n: number): EpochMillis => n as EpochMillis;

/** Outbound port: the current time. */
export interface Clock {
  now(): EpochMillis;
}

/** Outbound port: opaque unique id generation (not for secrets — see SecureRandom). */
export interface IdGenerator {
  next(): string;
}
