/** Reference KeyChallengeStore — in-memory, for tests and local dev. */
import type { ChallengeId } from "../domain/ids.js";
import type { KeyChallenge, KeyChallengeStore } from "../ports/outbound.js";

export class InMemoryKeyChallengeStore implements KeyChallengeStore {
  private readonly byId = new Map<ChallengeId, KeyChallenge>();

  async save(challenge: KeyChallenge): Promise<void> {
    this.byId.set(challenge.id, challenge);
  }

  async findById(id: ChallengeId): Promise<KeyChallenge | undefined> {
    return this.byId.get(id);
  }
}
