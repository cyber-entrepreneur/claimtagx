import type { AccountId, CredentialId } from "../domain/ids.js";
import type { Credential, CredentialKind, SocialProvider } from "../domain/credential.js";
import type { CredentialRepository } from "../ports/outbound.js";

/** In-memory CredentialRepository for tests and local development. */
export class InMemoryCredentialRepository implements CredentialRepository {
  private readonly byId = new Map<CredentialId, Credential>();

  async save(credential: Credential): Promise<void> {
    this.byId.set(credential.id, credential);
  }

  async findById(id: CredentialId): Promise<Credential | undefined> {
    return this.byId.get(id);
  }

  async listForAccount(accountId: AccountId): Promise<readonly Credential[]> {
    return [...this.byId.values()].filter((c) => c.accountId === accountId);
  }

  async findByKind(
    accountId: AccountId,
    kind: CredentialKind,
  ): Promise<Credential | undefined> {
    return [...this.byId.values()].find(
      (c) => c.accountId === accountId && c.kind === kind,
    );
  }

  async findBySocialSubject(
    provider: SocialProvider,
    subject: string,
  ): Promise<Credential | undefined> {
    return [...this.byId.values()].find(
      (c) => c.kind === "social" && c.provider === provider && c.subject === subject,
    );
  }

  async delete(id: CredentialId): Promise<void> {
    this.byId.delete(id);
  }
}
