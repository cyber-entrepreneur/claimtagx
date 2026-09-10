/// <reference types="node" />
import { eq } from "drizzle-orm";
import type { AccountId, ChallengeId } from "../../domain/ids.js";
import type { EpochMillis } from "../../shared/clock.js";
import type { KeyChallenge, KeyChallengeStore } from "../../ports/outbound.js";
import type { AuthDatabase } from "./database.js";
import { authKeyChallenges } from "./schema.js";

export interface KeyChallengeTables {
  readonly keyChallenges: typeof authKeyChallenges;
}

const DEFAULT_TABLES: KeyChallengeTables = { keyChallenges: authKeyChallenges };

/**
 * Durable {@link KeyChallengeStore} for anonymous key-based login nonces. Nonce
 * bytes are persisted base64-encoded in a `text` column to keep the schema
 * driver-agnostic (no `bytea` custom type required).
 */
export class PostgresKeyChallengeStore implements KeyChallengeStore {
  private readonly keyChallenges: typeof authKeyChallenges;

  constructor(
    private readonly db: AuthDatabase,
    tables: KeyChallengeTables = DEFAULT_TABLES,
  ) {
    this.keyChallenges = tables.keyChallenges;
  }

  async save(challenge: KeyChallenge): Promise<void> {
    await this.db
      .insert(this.keyChallenges)
      .values({
        id: challenge.id,
        accountId: challenge.accountId,
        nonce: Buffer.from(challenge.nonce).toString("base64"),
        createdAt: challenge.createdAt,
        expiresAt: challenge.expiresAt,
        consumedAt: challenge.consumedAt ?? null,
      })
      .onConflictDoUpdate({
        target: this.keyChallenges.id,
        set: { consumedAt: challenge.consumedAt ?? null },
      });
  }

  async findById(id: ChallengeId): Promise<KeyChallenge | undefined> {
    const rows = await this.db
      .select()
      .from(this.keyChallenges)
      .where(eq(this.keyChallenges.id, id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id as ChallengeId,
      accountId: row.accountId as AccountId,
      nonce: new Uint8Array(Buffer.from(row.nonce, "base64")),
      createdAt: row.createdAt as EpochMillis,
      expiresAt: row.expiresAt as EpochMillis,
      ...(row.consumedAt !== null ? { consumedAt: row.consumedAt as EpochMillis } : {}),
    };
  }
}
