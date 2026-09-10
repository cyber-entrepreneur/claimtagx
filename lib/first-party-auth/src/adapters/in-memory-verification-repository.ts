import type { ChallengeId } from "../domain/ids.js";
import type { VerificationChallenge } from "../domain/verification.js";
import type { VerificationRepository } from "../ports/outbound.js";

/** In-memory VerificationRepository for tests and local development. */
export class InMemoryVerificationRepository implements VerificationRepository {
  private readonly byId = new Map<ChallengeId, VerificationChallenge>();

  async save(challenge: VerificationChallenge): Promise<void> {
    this.byId.set(challenge.id, challenge);
  }

  async findById(id: ChallengeId): Promise<VerificationChallenge | undefined> {
    return this.byId.get(id);
  }
}
