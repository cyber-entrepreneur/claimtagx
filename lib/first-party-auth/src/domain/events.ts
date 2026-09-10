import type { DomainEvent } from "../shared/events.js";
import type { AccountId, SessionId, ChallengeId } from "./ids.js";
import type { ChallengePurpose } from "./verification.js";
import type { MfaMethod } from "./mfa.js";

/** Audit-grade domain events. Payloads carry ids only — never secrets/codes. */

export type AccountRegistered = DomainEvent<
  "auth.account.registered",
  { accountId: AccountId }
>;

export type IdentifierVerified = DomainEvent<
  "auth.identifier.verified",
  { accountId: AccountId; kind: "email" | "phone" | "username" }
>;

export type AuthSucceeded = DomainEvent<
  "auth.login.succeeded",
  { accountId: AccountId; sessionId: SessionId; method: string }
>;

export type AuthFailed = DomainEvent<
  "auth.login.failed",
  { accountId?: AccountId; reason: string }
>;

export type ChallengeIssued = DomainEvent<
  "auth.challenge.issued",
  { challengeId: ChallengeId; purpose: ChallengePurpose; accountId?: AccountId }
>;

export type MfaEnrolled = DomainEvent<
  "auth.mfa.enrolled",
  { accountId: AccountId; method: MfaMethod }
>;

export type SessionRevoked = DomainEvent<
  "auth.session.revoked",
  { accountId: AccountId; sessionId: SessionId }
>;

export type AuthEvent =
  | AccountRegistered
  | IdentifierVerified
  | AuthSucceeded
  | AuthFailed
  | ChallengeIssued
  | MfaEnrolled
  | SessionRevoked;
