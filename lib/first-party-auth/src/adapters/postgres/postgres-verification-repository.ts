import { eq } from "drizzle-orm";
import type { AccountId, ChallengeId } from "../../domain/ids.js";
import type { VerificationChallenge } from "../../domain/verification.js";
import type { EpochMillis } from "../../shared/clock.js";
import type { VerificationRepository } from "../../ports/outbound.js";
import type { AuthDatabase } from "./database.js";
import { authVerifications } from "./schema.js";

export interface VerificationTables {
  readonly verifications: typeof authVerifications;
}

const DEFAULT_TABLES: VerificationTables = { verifications: authVerifications };

/** Durable {@link VerificationRepository} over Postgres. */
export class PostgresVerificationRepository implements VerificationRepository {
  private readonly verifications: typeof authVerifications;

  constructor(
    private readonly db: AuthDatabase,
    tables: VerificationTables = DEFAULT_TABLES,
  ) {
    this.verifications = tables.verifications;
  }

  async save(challenge: VerificationChallenge): Promise<void> {
    const values = {
      id: challenge.id,
      accountId: challenge.accountId ?? null,
      channel: challenge.channel,
      destination: challenge.destination,
      purpose: challenge.purpose,
      codeHashRef: challenge.codeHashRef,
      createdAt: challenge.createdAt,
      expiresAt: challenge.expiresAt,
      consumedAt: challenge.consumedAt ?? null,
      attempts: challenge.attempts,
      maxAttempts: challenge.maxAttempts,
    };
    await this.db
      .insert(this.verifications)
      .values(values)
      .onConflictDoUpdate({
        target: this.verifications.id,
        set: {
          accountId: values.accountId,
          channel: values.channel,
          destination: values.destination,
          purpose: values.purpose,
          codeHashRef: values.codeHashRef,
          createdAt: values.createdAt,
          expiresAt: values.expiresAt,
          consumedAt: values.consumedAt,
          attempts: values.attempts,
          maxAttempts: values.maxAttempts,
        },
      });
  }

  async findById(id: ChallengeId): Promise<VerificationChallenge | undefined> {
    const rows = await this.db
      .select()
      .from(this.verifications)
      .where(eq(this.verifications.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToChallenge(row);
  }
}

function rowToChallenge(row: typeof authVerifications.$inferSelect): VerificationChallenge {
  let out: VerificationChallenge = {
    id: row.id as ChallengeId,
    channel: row.channel as VerificationChallenge["channel"],
    destination: row.destination,
    purpose: row.purpose as VerificationChallenge["purpose"],
    codeHashRef: row.codeHashRef,
    createdAt: row.createdAt as EpochMillis,
    expiresAt: row.expiresAt as EpochMillis,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
  };
  if (row.accountId !== null) {
    out = { ...out, accountId: row.accountId as AccountId };
  }
  if (row.consumedAt !== null) {
    out = { ...out, consumedAt: row.consumedAt as EpochMillis };
  }
  return out;
}
