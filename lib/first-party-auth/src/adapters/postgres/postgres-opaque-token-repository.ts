import { eq } from "drizzle-orm";
import type { AccountId, DeviceId, SessionId } from "../../domain/ids.js";
import type { AuthContext } from "../../domain/session.js";
import type { EpochMillis } from "../../shared/clock.js";
import type {
  OpaqueAccessRecord,
  OpaqueRefreshRecord,
  OpaqueTokenRepository,
} from "../opaque-token-service.js";
import type { AuthDatabase } from "./database.js";
import { authSessionTokens } from "./schema.js";

export interface OpaqueTokenTables {
  readonly sessionTokens: typeof authSessionTokens;
}

const DEFAULT_TABLES: OpaqueTokenTables = { sessionTokens: authSessionTokens };

type TokenRow = typeof authSessionTokens.$inferSelect;

/**
 * Durable {@link OpaqueTokenRepository} — one row per session holding the
 * SHA-256 hashes (never the raw tokens) of the current access/refresh tokens.
 * `saveTokens` upserts and only overwrites the columns it was given, so issuing
 * an access token then a refresh token for the same session merges into a
 * single row (and rotating either token supersedes the previous hash).
 */
export class PostgresOpaqueTokenRepository implements OpaqueTokenRepository {
  private readonly sessionTokens: typeof authSessionTokens;

  constructor(
    private readonly db: AuthDatabase,
    tables: OpaqueTokenTables = DEFAULT_TABLES,
  ) {
    this.sessionTokens = tables.sessionTokens;
  }

  async saveTokens(input: {
    readonly sessionId: SessionId;
    readonly accessHash?: string;
    readonly refreshHash?: string;
    readonly context?: AuthContext;
    readonly accessExpiresAt?: EpochMillis;
    readonly refreshExpiresAt?: EpochMillis;
  }): Promise<void> {
    const storedContext =
      input.context !== undefined
        ? {
            accountId: input.context.accountId,
            sessionId: input.context.sessionId,
            scopes: input.context.scopes,
            ...(input.context.deviceId !== undefined
              ? { deviceId: input.context.deviceId }
              : {}),
          }
        : undefined;

    const set: Record<string, unknown> = {};
    if (input.accessHash !== undefined) set["accessHash"] = input.accessHash;
    if (input.refreshHash !== undefined) set["refreshHash"] = input.refreshHash;
    if (storedContext !== undefined) set["context"] = storedContext;
    if (input.accessExpiresAt !== undefined) set["accessExpiresAt"] = input.accessExpiresAt;
    if (input.refreshExpiresAt !== undefined) set["refreshExpiresAt"] = input.refreshExpiresAt;

    await this.db
      .insert(this.sessionTokens)
      .values({
        sessionId: input.sessionId,
        accessHash: input.accessHash ?? null,
        refreshHash: input.refreshHash ?? null,
        context: storedContext ?? null,
        accessExpiresAt: input.accessExpiresAt ?? null,
        refreshExpiresAt: input.refreshExpiresAt ?? null,
      })
      .onConflictDoUpdate({
        target: this.sessionTokens.sessionId,
        set,
      });
  }

  async findByAccessHash(accessHash: string): Promise<OpaqueAccessRecord | undefined> {
    const rows = await this.db
      .select()
      .from(this.sessionTokens)
      .where(eq(this.sessionTokens.accessHash, accessHash))
      .limit(1);
    const row = rows[0];
    if (row === undefined || row.context === null || row.accessExpiresAt === null) {
      return undefined;
    }
    return {
      context: toAuthContext(row.context),
      expiresAt: row.accessExpiresAt as EpochMillis,
    };
  }

  async findByRefreshHash(refreshHash: string): Promise<OpaqueRefreshRecord | undefined> {
    const rows = await this.db
      .select()
      .from(this.sessionTokens)
      .where(eq(this.sessionTokens.refreshHash, refreshHash))
      .limit(1);
    const row = rows[0];
    if (row === undefined || row.refreshExpiresAt === null) {
      return undefined;
    }
    return {
      sessionId: row.sessionId as SessionId,
      expiresAt: row.refreshExpiresAt as EpochMillis,
    };
  }

  async revoke(sessionId: SessionId): Promise<void> {
    await this.db.delete(this.sessionTokens).where(eq(this.sessionTokens.sessionId, sessionId));
  }
}

function toAuthContext(stored: NonNullable<TokenRow["context"]>): AuthContext {
  return {
    accountId: stored.accountId as AccountId,
    sessionId: stored.sessionId as SessionId,
    scopes: stored.scopes,
    ...(stored.deviceId !== undefined ? { deviceId: stored.deviceId as DeviceId } : {}),
  };
}
