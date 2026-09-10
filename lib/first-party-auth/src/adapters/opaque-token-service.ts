/// <reference types="node" />
import { createHash } from "node:crypto";
import type { SessionId } from "../domain/ids.js";
import type { AuthContext } from "../domain/session.js";
import type { Clock, EpochMillis } from "../shared/clock.js";
import type { SecureRandom } from "../shared/random.js";
import type { TokenService } from "../ports/outbound.js";

/** Bytes of entropy per opaque token (256-bit). */
const TOKEN_BYTES = 32;
const ACCESS_PREFIX = "cta_at_";
const REFRESH_PREFIX = "cta_rt_";

export interface OpaqueAccessRecord {
  readonly context: AuthContext;
  readonly expiresAt: EpochMillis;
}

export interface OpaqueRefreshRecord {
  readonly sessionId: SessionId;
  readonly expiresAt: EpochMillis;
}

/**
 * Outbound port for durable opaque-token storage.
 *
 * The service NEVER hands raw tokens to this port — only their SHA-256 hashes,
 * so a database compromise cannot yield usable tokens. Writes are keyed by
 * `sessionId` and MERGE: a call that supplies only the access fields must not
 * clobber previously-stored refresh fields (and vice-versa). Overwriting a hash
 * for a session invalidates the previously-stored token for that slot (token
 * rotation on refresh).
 */
export interface OpaqueTokenRepository {
  saveTokens(input: {
    readonly sessionId: SessionId;
    readonly accessHash?: string;
    readonly refreshHash?: string;
    readonly context?: AuthContext;
    readonly accessExpiresAt?: EpochMillis;
    readonly refreshExpiresAt?: EpochMillis;
  }): Promise<void>;
  findByAccessHash(accessHash: string): Promise<OpaqueAccessRecord | undefined>;
  findByRefreshHash(refreshHash: string): Promise<OpaqueRefreshRecord | undefined>;
  /** Drop all token material for a session (e.g. on logout / revoke-all). */
  revoke(sessionId: SessionId): Promise<void>;
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("base64url");

/**
 * Production `TokenService` that mints cryptographically-random opaque tokens
 * and persists ONLY their hashes via an injected {@link OpaqueTokenRepository}.
 *
 * Access and refresh tokens are issued in separate calls (the application layer
 * issues them back-to-back for a session). Each call persists its own slot via
 * a merging `saveTokens` write, so no in-process buffering of secrets is needed.
 * `verifyAccess`/`verifyRefresh` re-hash the presented token, look it up, and
 * enforce the stored expiry against the injected `Clock`.
 */
export class OpaqueTokenService implements TokenService {
  constructor(
    private readonly repository: OpaqueTokenRepository,
    private readonly random: SecureRandom,
    private readonly clock: Clock,
  ) {}

  private mint(prefix: string): { token: string; hash: string } {
    const token = `${prefix}${Buffer.from(this.random.bytes(TOKEN_BYTES)).toString("base64url")}`;
    return { token, hash: hashToken(token) };
  }

  async issueAccess(context: AuthContext, expiresAt: EpochMillis): Promise<string> {
    const { token, hash } = this.mint(ACCESS_PREFIX);
    await this.repository.saveTokens({
      sessionId: context.sessionId,
      accessHash: hash,
      context,
      accessExpiresAt: expiresAt,
    });
    return token;
  }

  async issueRefresh(sessionId: SessionId, expiresAt: EpochMillis): Promise<string> {
    const { token, hash } = this.mint(REFRESH_PREFIX);
    await this.repository.saveTokens({
      sessionId,
      refreshHash: hash,
      refreshExpiresAt: expiresAt,
    });
    return token;
  }

  async verifyAccess(token: string): Promise<AuthContext | null> {
    const record = await this.repository.findByAccessHash(hashToken(token));
    if (record === undefined) {
      return null;
    }
    if (record.expiresAt <= this.clock.now()) {
      return null;
    }
    return record.context;
  }

  async verifyRefresh(token: string): Promise<SessionId | null> {
    const record = await this.repository.findByRefreshHash(hashToken(token));
    if (record === undefined) {
      return null;
    }
    if (record.expiresAt <= this.clock.now()) {
      return null;
    }
    return record.sessionId;
  }
}

interface TokenRow {
  accessHash?: string;
  refreshHash?: string;
  context?: AuthContext;
  accessExpiresAt?: EpochMillis;
  refreshExpiresAt?: EpochMillis;
}

/**
 * In-memory `OpaqueTokenRepository` for tests and local development. Maintains
 * hash → sessionId indexes so lookups are O(1) and token rotation correctly
 * evicts superseded hashes.
 */
export class InMemoryOpaqueTokenRepository implements OpaqueTokenRepository {
  private readonly rows = new Map<SessionId, TokenRow>();
  private readonly accessIndex = new Map<string, SessionId>();
  private readonly refreshIndex = new Map<string, SessionId>();

  async saveTokens(input: {
    readonly sessionId: SessionId;
    readonly accessHash?: string;
    readonly refreshHash?: string;
    readonly context?: AuthContext;
    readonly accessExpiresAt?: EpochMillis;
    readonly refreshExpiresAt?: EpochMillis;
  }): Promise<void> {
    const row = this.rows.get(input.sessionId) ?? {};

    if (input.accessHash !== undefined) {
      if (row.accessHash !== undefined && row.accessHash !== input.accessHash) {
        this.accessIndex.delete(row.accessHash);
      }
      row.accessHash = input.accessHash;
      this.accessIndex.set(input.accessHash, input.sessionId);
    }
    if (input.refreshHash !== undefined) {
      if (row.refreshHash !== undefined && row.refreshHash !== input.refreshHash) {
        this.refreshIndex.delete(row.refreshHash);
      }
      row.refreshHash = input.refreshHash;
      this.refreshIndex.set(input.refreshHash, input.sessionId);
    }
    if (input.context !== undefined) {
      row.context = input.context;
    }
    if (input.accessExpiresAt !== undefined) {
      row.accessExpiresAt = input.accessExpiresAt;
    }
    if (input.refreshExpiresAt !== undefined) {
      row.refreshExpiresAt = input.refreshExpiresAt;
    }
    this.rows.set(input.sessionId, row);
  }

  async findByAccessHash(accessHash: string): Promise<OpaqueAccessRecord | undefined> {
    const sessionId = this.accessIndex.get(accessHash);
    if (sessionId === undefined) {
      return undefined;
    }
    const row = this.rows.get(sessionId);
    if (row?.context === undefined || row.accessExpiresAt === undefined) {
      return undefined;
    }
    return { context: row.context, expiresAt: row.accessExpiresAt };
  }

  async findByRefreshHash(refreshHash: string): Promise<OpaqueRefreshRecord | undefined> {
    const sessionId = this.refreshIndex.get(refreshHash);
    if (sessionId === undefined) {
      return undefined;
    }
    const row = this.rows.get(sessionId);
    if (row?.refreshExpiresAt === undefined) {
      return undefined;
    }
    return { sessionId, expiresAt: row.refreshExpiresAt };
  }

  async revoke(sessionId: SessionId): Promise<void> {
    const row = this.rows.get(sessionId);
    if (row === undefined) {
      return;
    }
    if (row.accessHash !== undefined) {
      this.accessIndex.delete(row.accessHash);
    }
    if (row.refreshHash !== undefined) {
      this.refreshIndex.delete(row.refreshHash);
    }
    this.rows.delete(sessionId);
  }
}
