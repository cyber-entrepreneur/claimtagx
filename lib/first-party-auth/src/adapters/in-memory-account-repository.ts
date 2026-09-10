import type { AccountId } from "../domain/ids.js";
import type { Account, Identifier } from "../domain/account.js";
import type { AccountRepository } from "../ports/outbound.js";

/** In-memory AccountRepository for tests and local development. */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly byId = new Map<AccountId, Account>();

  async save(account: Account): Promise<void> {
    this.byId.set(account.id, account);
  }

  async findById(id: AccountId): Promise<Account | undefined> {
    return this.byId.get(id);
  }

  async findByIdentifier(
    kind: Identifier["kind"],
    value: string,
  ): Promise<Account | undefined> {
    for (const account of this.byId.values()) {
      if (account.identifiers.some((i) => i.kind === kind && i.value === value)) {
        return account;
      }
    }
    return undefined;
  }
}
