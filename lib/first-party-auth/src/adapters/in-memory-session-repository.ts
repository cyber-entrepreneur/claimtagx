import type { AccountId, SessionId } from "../domain/ids.js";
import type { Session } from "../domain/session.js";
import type { SessionRepository } from "../ports/outbound.js";

/** In-memory SessionRepository for tests and local development. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<SessionId, Session>();

  async save(session: Session): Promise<void> {
    this.byId.set(session.id, session);
  }

  async findById(id: SessionId): Promise<Session | undefined> {
    return this.byId.get(id);
  }

  async listForAccount(accountId: AccountId): Promise<readonly Session[]> {
    return [...this.byId.values()].filter((s) => s.accountId === accountId);
  }
}
