/**
 * Anonymous key-based identity (Threema-style): an account whose identity IS a
 * self-generated keypair. Registration uploads only the public key — no phone,
 * email, or password. Login is challenge-response: the server issues a one-time
 * nonce, the client signs it with the private key (which never leaves the
 * device), and the signature is verified against the stored public key.
 */

import type { AccountId, ChallengeId, CredentialId } from "../domain/ids.js";
import type { Account } from "../domain/account.js";
import type { PublicKeyCredential, SignatureAlgorithm } from "../domain/credential.js";
import type { Clock, IdGenerator } from "../shared/clock.js";
import { epochMillis } from "../shared/clock.js";
import type { EventPublisher } from "../shared/events.js";
import { domainEvent } from "../shared/events.js";
import type { SecureRandom } from "../shared/random.js";
import { authError, err, ok } from "../shared/result.js";
import { asId } from "../shared/ids.js";
import type {
  AnonymousIdentityService,
  AuthResult,
  LoginOutcome,
  RequestContext,
} from "../ports/inbound.js";
import type {
  AccountRepository,
  CredentialRepository,
  KeyChallenge,
  KeyChallengeStore,
  RateLimiter,
  SignatureVerifier,
} from "../ports/outbound.js";
import { assertAccountUsable, issueAuthenticatedSession, type SessionIssuerDeps } from "./session-support.js";

/** One-time login nonce lifetime + size. */
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const NONCE_BYTES = 32;

export interface AnonymousIdentityServiceDeps extends SessionIssuerDeps {
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly challenges: KeyChallengeStore;
  readonly verifier: SignatureVerifier;
  readonly rateLimiter: RateLimiter;
  readonly random: SecureRandom;
}

export class AnonymousIdentityServiceImpl implements AnonymousIdentityService {
  constructor(private readonly deps: AnonymousIdentityServiceDeps) {}

  async register(input: {
    readonly algorithm: SignatureAlgorithm;
    readonly publicKey: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<{ account: Account }>> {
    if (input.publicKey.length === 0) {
      return err(authError("INVALID_CREDENTIALS", "A public key is required."));
    }

    const now = this.deps.clock.now();
    const accountId = asId(this.deps.ids.next()) as AccountId;
    // Anonymous: no identifiers, no PII. The key IS the identity → active at once.
    const account: Account = {
      id: accountId,
      identifiers: [],
      status: "active",
      mfaRequired: false,
      createdAt: now,
    };
    await this.deps.accounts.save(account);

    const credential: PublicKeyCredential = {
      id: asId(this.deps.ids.next()) as CredentialId,
      accountId,
      kind: "public_key",
      algorithm: input.algorithm,
      publicKey: input.publicKey,
      createdAt: now,
    };
    await this.deps.credentials.save(credential);

    await this.deps.events.publish(
      domainEvent("auth.account.registered", now, { accountId }),
    );

    return ok({ account });
  }

  async beginChallenge(input: {
    readonly accountId: AccountId;
    readonly context?: RequestContext;
  }): Promise<AuthResult<{ challengeId: ChallengeId; nonce: Uint8Array }>> {
    const rlKey = `anon-challenge:${input.context?.ipAddress ?? String(input.accountId)}`;
    const decision = await this.deps.rateLimiter.hit(rlKey);
    if (!decision.allowed) {
      return err(
        authError("RATE_LIMITED", "Too many challenge requests.", {
          retryAfterMs: decision.retryAfterMs,
        }),
      );
    }

    const account = await this.deps.accounts.findById(input.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }
    const credential = await this.deps.credentials.findByKind(input.accountId, "public_key");
    if (credential === undefined || credential.kind !== "public_key") {
      return err(authError("INVALID_CREDENTIALS", "Account has no identity key."));
    }

    const now = this.deps.clock.now();
    const nonce = this.deps.random.bytes(NONCE_BYTES);
    const challengeId = asId(this.deps.ids.next()) as ChallengeId;
    const challenge: KeyChallenge = {
      id: challengeId,
      accountId: input.accountId,
      nonce,
      createdAt: now,
      expiresAt: epochMillis(now + CHALLENGE_TTL_MS),
    };
    await this.deps.challenges.save(challenge);

    return ok({ challengeId, nonce });
  }

  async completeChallenge(input: {
    readonly challengeId: ChallengeId;
    readonly signature: Uint8Array;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>> {
    const rlKey = `anon-verify:${input.context?.ipAddress ?? String(input.challengeId)}`;
    const decision = await this.deps.rateLimiter.hit(rlKey);
    if (!decision.allowed) {
      return err(
        authError("RATE_LIMITED", "Too many verification attempts.", {
          retryAfterMs: decision.retryAfterMs,
        }),
      );
    }

    const challenge = await this.deps.challenges.findById(input.challengeId);
    if (challenge === undefined || challenge.consumedAt !== undefined) {
      return err(authError("CHALLENGE_INVALID", "Unknown or already-used challenge."));
    }

    const now = this.deps.clock.now();
    if (challenge.expiresAt <= now) {
      return err(authError("CHALLENGE_EXPIRED", "This challenge has expired."));
    }

    const account = await this.deps.accounts.findById(challenge.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }
    const usable = assertAccountUsable(account, now);
    if (!usable.ok) {
      return err(usable.error);
    }

    const credential = await this.deps.credentials.findByKind(challenge.accountId, "public_key");
    if (credential === undefined || credential.kind !== "public_key") {
      return err(authError("INVALID_CREDENTIALS", "Account has no identity key."));
    }

    const valid = await this.deps.verifier.verify({
      algorithm: credential.algorithm,
      publicKey: credential.publicKey,
      message: challenge.nonce,
      signature: input.signature,
    });
    if (!valid) {
      return err(authError("SIGNATURE_INVALID", "Signature verification failed."));
    }

    // Consume the nonce (one-time) BEFORE issuing the session.
    await this.deps.challenges.save({ ...challenge, consumedAt: now });

    const outcome = await issueAuthenticatedSession(this.deps, account, input.context, "identity_key");
    return ok(outcome);
  }
}
