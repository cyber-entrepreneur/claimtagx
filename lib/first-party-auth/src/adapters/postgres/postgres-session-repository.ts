import { eq } from "drizzle-orm";
import type { AccountId, DeviceId, SessionId } from "../../domain/ids.js";
import type { Session } from "../../domain/session.js";
import type { EpochMillis } from "../../shared/clock.js";
import type { SessionRepository } from "../../ports/outbound.js";
import type { AuthDatabase } from "./database.js";
import { authSessions } from "./schema.js";

export interface SessionTables {
  readonly sessions: typeof authSessions;
}

const DEFAULT_TABLES: SessionTables = { sessions: authSessions };

/** Durable {@link SessionRepository} over Postgres. */
export class PostgresSessionRepository implements SessionRepository {
  private readonly sessions: typeof authSessions;

  constructor(
    private readonly db: AuthDatabase,
    tables: SessionTables = DEFAULT_TABLES,
  ) {
    this.sessions = tables.sessions;
  }

  async save(session: Session): Promise<void> {
    await this.db
      .insert(this.sessions)
      .values({
        id: session.id,
        accountId: session.accountId,
        deviceId: session.deviceId ?? null,
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
        refreshExpiresAt: session.refreshExpiresAt ?? null,
        revokedAt: session.revokedAt ?? null,
      })
      .onConflictDoUpdate({
        target: this.sessions.id,
        set: {
          accountId: session.accountId,
          deviceId: session.deviceId ?? null,
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt,
          refreshExpiresAt: session.refreshExpiresAt ?? null,
          revokedAt: session.revokedAt ?? null,
        },
      });
  }

  async findById(id: SessionId): Promise<Session | undefined> {
    const rows = await this.db
      .select()
      .from(this.sessions)
      .where(eq(this.sessions.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToSession(row);
  }

  async listForAccount(accountId: AccountId): Promise<readonly Session[]> {
    const rows = await this.db
      .select()
      .from(this.sessions)
      .where(eq(this.sessions.accountId, accountId));
    return rows.map(rowToSession);
  }
}

function rowToSession(row: typeof authSessions.$inferSelect): Session {
  let out: Session = {
    id: row.id as SessionId,
    accountId: row.accountId as AccountId,
    issuedAt: row.issuedAt as EpochMillis,
    expiresAt: row.expiresAt as EpochMillis,
  };
  if (row.deviceId !== null) {
    out = { ...out, deviceId: row.deviceId as DeviceId };
  }
  if (row.refreshExpiresAt !== null) {
    out = { ...out, refreshExpiresAt: row.refreshExpiresAt as EpochMillis };
  }
  if (row.revokedAt !== null) {
    out = { ...out, revokedAt: row.revokedAt as EpochMillis };
  }
  return out;
}
