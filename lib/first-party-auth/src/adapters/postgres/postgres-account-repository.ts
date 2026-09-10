import { and, eq } from "drizzle-orm";
import type { Account, Identifier } from "../../domain/account.js";
import type { AccountId } from "../../domain/ids.js";
import type { EpochMillis } from "../../shared/clock.js";
import type { AccountRepository } from "../../ports/outbound.js";
import type { AuthDatabase } from "./database.js";
import { authAccounts, authIdentifiers } from "./schema.js";

export interface AccountTables {
  readonly accounts: typeof authAccounts;
  readonly identifiers: typeof authIdentifiers;
}

const DEFAULT_TABLES: AccountTables = {
  accounts: authAccounts,
  identifiers: authIdentifiers,
};

/** Durable {@link AccountRepository} over Postgres via an injected drizzle db. */
export class PostgresAccountRepository implements AccountRepository {
  private readonly accounts: typeof authAccounts;
  private readonly identifiers: typeof authIdentifiers;

  constructor(
    private readonly db: AuthDatabase,
    tables: AccountTables = DEFAULT_TABLES,
  ) {
    this.accounts = tables.accounts;
    this.identifiers = tables.identifiers;
  }

  async save(account: Account): Promise<void> {
    await this.db
      .insert(this.accounts)
      .values({
        id: account.id,
        status: account.status,
        mfaRequired: account.mfaRequired,
        createdAt: account.createdAt,
        lockedUntil: account.lockedUntil ?? null,
      })
      .onConflictDoUpdate({
        target: this.accounts.id,
        set: {
          status: account.status,
          mfaRequired: account.mfaRequired,
          lockedUntil: account.lockedUntil ?? null,
        },
      });

    await this.db.delete(this.identifiers).where(eq(this.identifiers.accountId, account.id));
    if (account.identifiers.length > 0) {
      await this.db.insert(this.identifiers).values(
        account.identifiers.map((identifier) => ({
          accountId: account.id,
          kind: identifier.kind,
          value: identifier.value,
          verified: identifier.verified,
        })),
      );
    }
  }

  async findById(id: AccountId): Promise<Account | undefined> {
    const rows = await this.db
      .select()
      .from(this.accounts)
      .where(eq(this.accounts.id, id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    const idRows = await this.db
      .select()
      .from(this.identifiers)
      .where(eq(this.identifiers.accountId, id));
    return rowToAccount(row, idRows);
  }

  async findByIdentifier(
    kind: Identifier["kind"],
    value: string,
  ): Promise<Account | undefined> {
    const hits = await this.db
      .select()
      .from(this.identifiers)
      .where(and(eq(this.identifiers.kind, kind), eq(this.identifiers.value, value)))
      .limit(1);
    const idRow = hits[0];
    if (idRow === undefined) {
      return undefined;
    }
    return this.findById(idRow.accountId as AccountId);
  }
}

function rowToAccount(
  row: typeof authAccounts.$inferSelect,
  idRows: (typeof authIdentifiers.$inferSelect)[],
): Account {
  const base: Account = {
    id: row.id as AccountId,
    identifiers: idRows.map((i) => ({
      kind: i.kind as Identifier["kind"],
      value: i.value,
      verified: i.verified,
    })),
    status: row.status as Account["status"],
    mfaRequired: row.mfaRequired,
    createdAt: row.createdAt as EpochMillis,
  };
  if (row.lockedUntil === null) {
    return base;
  }
  return { ...base, lockedUntil: row.lockedUntil as EpochMillis };
}
