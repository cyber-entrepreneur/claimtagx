import { and, eq, sql } from "drizzle-orm";
import type { AccountId, CredentialId } from "../../domain/ids.js";
import type {
  Credential,
  CredentialKind,
  SignatureAlgorithm,
  SocialProvider,
} from "../../domain/credential.js";
import type { EpochMillis } from "../../shared/clock.js";
import type { CredentialRepository } from "../../ports/outbound.js";
import type { AuthDatabase } from "./database.js";
import { authCredentials } from "./schema.js";

export interface CredentialTables {
  readonly credentials: typeof authCredentials;
}

const DEFAULT_TABLES: CredentialTables = { credentials: authCredentials };

/**
 * Durable {@link CredentialRepository} over Postgres. The discriminated
 * `Credential` union is stored with its stable columns (`id`, `accountId`,
 * `kind`, `createdAt`) plus a `jsonb` `data` blob for the kind-specific fields,
 * so new credential kinds never require a migration.
 */
export class PostgresCredentialRepository implements CredentialRepository {
  private readonly credentials: typeof authCredentials;

  constructor(
    private readonly db: AuthDatabase,
    tables: CredentialTables = DEFAULT_TABLES,
  ) {
    this.credentials = tables.credentials;
  }

  async save(credential: Credential): Promise<void> {
    const { id, accountId, kind, createdAt, data } = split(credential);
    await this.db
      .insert(this.credentials)
      .values({ id, accountId, kind, createdAt, data })
      .onConflictDoUpdate({
        target: this.credentials.id,
        set: { accountId, kind, createdAt, data },
      });
  }

  async findById(id: CredentialId): Promise<Credential | undefined> {
    const rows = await this.db
      .select()
      .from(this.credentials)
      .where(eq(this.credentials.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToCredential(row);
  }

  async listForAccount(accountId: AccountId): Promise<readonly Credential[]> {
    const rows = await this.db
      .select()
      .from(this.credentials)
      .where(eq(this.credentials.accountId, accountId));
    return rows.map(rowToCredential);
  }

  async findByKind(
    accountId: AccountId,
    kind: CredentialKind,
  ): Promise<Credential | undefined> {
    const rows = await this.db
      .select()
      .from(this.credentials)
      .where(and(eq(this.credentials.accountId, accountId), eq(this.credentials.kind, kind)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToCredential(row);
  }

  async findBySocialSubject(
    provider: SocialProvider,
    subject: string,
  ): Promise<Credential | undefined> {
    const rows = await this.db
      .select()
      .from(this.credentials)
      .where(
        and(
          eq(this.credentials.kind, "social"),
          sql`${this.credentials.data}->>'provider' = ${provider}`,
          sql`${this.credentials.data}->>'subject' = ${subject}`,
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToCredential(row);
  }

  async delete(id: CredentialId): Promise<void> {
    await this.db.delete(this.credentials).where(eq(this.credentials.id, id));
  }
}

function split(credential: Credential): {
  id: string;
  accountId: string;
  kind: string;
  createdAt: number;
  data: Record<string, unknown>;
} {
  const { id, accountId, kind, createdAt, ...rest } = credential;
  return { id, accountId, kind, createdAt, data: rest as Record<string, unknown> };
}

function rowToCredential(row: typeof authCredentials.$inferSelect): Credential {
  const data = row.data;
  const base = {
    id: row.id as CredentialId,
    accountId: row.accountId as AccountId,
    createdAt: row.createdAt as EpochMillis,
  };
  switch (row.kind) {
    case "password":
      return {
        ...base,
        kind: "password",
        hashRef: String(data["hashRef"]),
        updatedAt: data["updatedAt"] as EpochMillis,
      };
    case "totp": {
      const totp = {
        ...base,
        kind: "totp" as const,
        secretRef: String(data["secretRef"]),
      };
      if (data["confirmedAt"] === undefined || data["confirmedAt"] === null) {
        return totp;
      }
      return { ...totp, confirmedAt: data["confirmedAt"] as EpochMillis };
    }
    case "social":
      return {
        ...base,
        kind: "social",
        provider: data["provider"] as SocialProvider,
        subject: String(data["subject"]),
      };
    case "recovery":
      return {
        ...base,
        kind: "recovery",
        codeHashes: data["codeHashes"] as readonly string[],
      };
    case "passkey":
      return {
        ...base,
        kind: "passkey",
        webauthnId: String(data["webauthnId"]),
        publicKey: String(data["publicKey"]),
        signCount: Number(data["signCount"]),
      };
    case "public_key":
      return {
        ...base,
        kind: "public_key",
        algorithm: data["algorithm"] as SignatureAlgorithm,
        publicKey: String(data["publicKey"]),
      };
    default:
      throw new Error(`Unknown credential kind: ${row.kind}`);
  }
}
