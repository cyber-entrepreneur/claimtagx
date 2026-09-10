import type { EpochMillis } from "../shared/clock.js";
import type { AccountId, SessionId, DeviceId } from "./ids.js";

/**
 * A session is issued after a successful, fully-satisfied authentication (all
 * required factors passed). Tokens themselves are opaque strings minted by a
 * `TokenService` adapter (JWT or server-side handle) — the domain models the
 * session's lifecycle, not the token format.
 */

export interface Session {
  readonly id: SessionId;
  readonly accountId: AccountId;
  readonly deviceId?: DeviceId;
  readonly issuedAt: EpochMillis;
  readonly expiresAt: EpochMillis;
  /** Refresh window; absent for non-refreshable (short-lived) sessions. */
  readonly refreshExpiresAt?: EpochMillis;
  readonly revokedAt?: EpochMillis;
}

/** What a caller receives on success. Strings are opaque; do not parse in core. */
export interface TokenPair {
  readonly accessToken: string;
  readonly accessExpiresAt: EpochMillis;
  readonly refreshToken?: string;
  readonly refreshExpiresAt?: EpochMillis;
}

/**
 * The verified principal derived from an access token — the whole point of the
 * package for a downstream service. The comms-core server consumes exactly this
 * to obtain a trusted `accountId`/`deviceId` before calling the platform.
 */
export interface AuthContext {
  readonly accountId: AccountId;
  readonly sessionId: SessionId;
  readonly deviceId?: DeviceId;
  readonly scopes: readonly string[];
}

export const isActive = (session: Session, now: EpochMillis): boolean =>
  session.revokedAt === undefined && session.expiresAt > now;
