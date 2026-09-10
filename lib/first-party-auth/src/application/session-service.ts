import type { AccountId, SessionId } from "../domain/ids.js";
import type { AuthContext, Session, TokenPair } from "../domain/session.js";
import type { Clock, IdGenerator } from "../shared/clock.js";
import { epochMillis } from "../shared/clock.js";
import type { EventPublisher } from "../shared/events.js";
import { domainEvent } from "../shared/events.js";
import { authError, err, ok } from "../shared/result.js";
import type { AuthResult, SessionService } from "../ports/inbound.js";
import type { SessionRepository, TokenService } from "../ports/outbound.js";
import { ACCESS_TTL_MS, REFRESH_TTL_MS } from "./session-support.js";

export interface SessionServiceDeps {
  readonly sessions: SessionRepository;
  readonly tokens: TokenService;
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly accessTtlMs?: number;
  readonly refreshTtlMs?: number;
}

export class SessionServiceImpl implements SessionService {
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;

  constructor(private readonly deps: SessionServiceDeps) {
    this.accessTtlMs = deps.accessTtlMs ?? ACCESS_TTL_MS;
    this.refreshTtlMs = deps.refreshTtlMs ?? REFRESH_TTL_MS;
  }

  async verify(accessToken: string): Promise<AuthResult<AuthContext>> {
    const context = await this.deps.tokens.verifyAccess(accessToken);
    if (context === null) {
      return err(authError("TOKEN_INVALID", "The access token is invalid."));
    }

    const session = await this.deps.sessions.findById(context.sessionId);
    if (session === undefined) {
      return err(authError("TOKEN_INVALID", "The access token is invalid."));
    }
    if (session.revokedAt !== undefined) {
      return err(authError("SESSION_REVOKED", "This session has been revoked."));
    }

    const now = this.deps.clock.now();
    if (session.expiresAt <= now) {
      return err(authError("TOKEN_EXPIRED", "The access token has expired."));
    }

    return ok(context);
  }

  async refresh(refreshToken: string): Promise<AuthResult<TokenPair>> {
    const sessionId = await this.deps.tokens.verifyRefresh(refreshToken);
    if (sessionId === null) {
      return err(authError("TOKEN_INVALID", "The refresh token is invalid."));
    }

    const session = await this.deps.sessions.findById(sessionId);
    if (session === undefined) {
      return err(authError("TOKEN_INVALID", "The refresh token is invalid."));
    }
    if (session.revokedAt !== undefined) {
      return err(authError("SESSION_REVOKED", "This session has been revoked."));
    }

    const now = this.deps.clock.now();
    if (session.refreshExpiresAt === undefined || session.refreshExpiresAt <= now) {
      return err(authError("TOKEN_EXPIRED", "The refresh token has expired."));
    }

    const accessExpiresAt = epochMillis(now + this.accessTtlMs);
    const refreshExpiresAt = epochMillis(now + this.refreshTtlMs);

    const rotatedSession: Session = {
      ...session,
      expiresAt: refreshExpiresAt,
      refreshExpiresAt,
    };
    await this.deps.sessions.save(rotatedSession);

    const authContext: AuthContext = {
      accountId: session.accountId,
      sessionId: session.id,
      scopes: [],
      ...(session.deviceId !== undefined ? { deviceId: session.deviceId } : {}),
    };

    const accessToken = await this.deps.tokens.issueAccess(authContext, accessExpiresAt);
    const newRefreshToken = await this.deps.tokens.issueRefresh(session.id, refreshExpiresAt);

    return ok({
      accessToken,
      accessExpiresAt,
      refreshToken: newRefreshToken,
      refreshExpiresAt,
    });
  }

  async revoke(sessionId: SessionId): Promise<AuthResult<void>> {
    const session = await this.deps.sessions.findById(sessionId);
    if (session === undefined || session.revokedAt !== undefined) {
      return ok(undefined);
    }

    const now = this.deps.clock.now();
    await this.deps.sessions.save({ ...session, revokedAt: now });
    await this.deps.events.publish(
      domainEvent("auth.session.revoked", now, { accountId: session.accountId, sessionId }),
    );

    return ok(undefined);
  }

  async revokeAll(accountId: AccountId): Promise<AuthResult<void>> {
    const sessions = await this.deps.sessions.listForAccount(accountId);
    const now = this.deps.clock.now();

    for (const session of sessions) {
      if (session.revokedAt === undefined) {
        await this.deps.sessions.save({ ...session, revokedAt: now });
        await this.deps.events.publish(
          domainEvent("auth.session.revoked", now, { accountId, sessionId: session.id }),
        );
      }
    }

    return ok(undefined);
  }
}
