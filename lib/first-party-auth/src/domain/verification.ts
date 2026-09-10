import type { EpochMillis } from "../shared/clock.js";
import type { AccountId, ChallengeId } from "./ids.js";

/**
 * A verification challenge is the one-time-code lifecycle behind phone/email
 * verification, OTP login, password reset, and MFA step-up. The code is stored
 * ONLY as a hash reference (`codeHashRef`); the plaintext is delivered once via
 * a `CodeDeliverer` adapter and never persisted by the core.
 */

export type ChallengePurpose =
  | "identifier_verify" // confirm a new email/phone
  | "login_otp" // passwordless / phone login
  | "password_reset"
  | "mfa_step_up"; // second factor at an elevated action

export type DeliveryChannel = "sms" | "email";

export interface VerificationChallenge {
  readonly id: ChallengeId;
  /** Absent during registration before an account row exists. */
  readonly accountId?: AccountId;
  readonly channel: DeliveryChannel;
  /** The normalized destination the code was sent to. */
  readonly destination: string;
  readonly purpose: ChallengePurpose;
  readonly codeHashRef: string;
  readonly createdAt: EpochMillis;
  readonly expiresAt: EpochMillis;
  readonly consumedAt?: EpochMillis;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Policy value object; hosts may override lengths/TTL when issuing. */
export interface CodePolicy {
  readonly length: number;
  readonly ttlMs: number;
  readonly maxAttempts: number;
}

export const defaultCodePolicy: CodePolicy = {
  length: 6,
  ttlMs: 5 * 60 * 1000,
  maxAttempts: 5,
};

export const isChallengeExpired = (c: VerificationChallenge, now: EpochMillis): boolean =>
  c.expiresAt <= now;

export const canAttempt = (c: VerificationChallenge, now: EpochMillis): boolean =>
  c.consumedAt === undefined && !isChallengeExpired(c, now) && c.attempts < c.maxAttempts;
