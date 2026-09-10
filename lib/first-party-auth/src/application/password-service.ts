import type { AccountId, ChallengeId, CredentialId } from "../domain/ids.js";
import type { Identifier } from "../domain/account.js";
import { normalizeIdentifier } from "../domain/account.js";
import type { PasswordCredential } from "../domain/credential.js";
import type { DeliveryChannel, VerificationChallenge } from "../domain/verification.js";
import { defaultCodePolicy } from "../domain/verification.js";
import type { PasswordPolicy } from "../domain/password-policy.js";
import { defaultPasswordPolicy, describePasswordPolicy, isPasswordAcceptable } from "../domain/password-policy.js";
import type { Clock, IdGenerator } from "../shared/clock.js";
import { epochMillis } from "../shared/clock.js";
import type { EventPublisher } from "../shared/events.js";
import { domainEvent } from "../shared/events.js";
import type { SecureRandom } from "../shared/random.js";
import { authError, err, ok } from "../shared/result.js";
import { asId } from "../shared/ids.js";
import type { AuthResult, PasswordService } from "../ports/inbound.js";
import type {
  AccountRepository,
  CodeDeliverer,
  CredentialRepository,
  PasswordHasher,
  RateLimiter,
  VerificationRepository,
} from "../ports/outbound.js";
import { consumeChallenge, generateNumericCode } from "./session-support.js";

export interface PasswordServiceDeps {
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly verifications: VerificationRepository;
  readonly hasher: PasswordHasher;
  readonly deliverer: CodeDeliverer;
  readonly rateLimiter: RateLimiter;
  readonly random: SecureRandom;
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly passwordPolicy?: PasswordPolicy;
}

export class PasswordServiceImpl implements PasswordService {
  private readonly passwordPolicy: PasswordPolicy;

  constructor(private readonly deps: PasswordServiceDeps) {
    this.passwordPolicy = deps.passwordPolicy ?? defaultPasswordPolicy;
  }

  async requestReset(input: {
    readonly identifier: { readonly kind: Identifier["kind"]; readonly value: string };
    readonly channel: DeliveryChannel;
  }): Promise<AuthResult<{ challengeId: ChallengeId }>> {
    const normalizedValue = normalizeIdentifier(input.identifier.kind, input.identifier.value);
    const rateLimitKey = `reset:${input.identifier.kind}:${normalizedValue}`;
    const decision = await this.deps.rateLimiter.hit(rateLimitKey);
    if (!decision.allowed) {
      return err(
        authError("RATE_LIMITED", "Too many reset requests.", {
          retryAfterMs: decision.retryAfterMs,
        }),
      );
    }

    const account = await this.deps.accounts.findByIdentifier(input.identifier.kind, normalizedValue);
    const now = this.deps.clock.now();
    const code = generateNumericCode(this.deps.random, defaultCodePolicy.length);
    const codeHashRef = await this.deps.hasher.hash(code);
    const challengeId = asId(this.deps.ids.next()) as ChallengeId;

    const challenge: VerificationChallenge = {
      id: challengeId,
      channel: input.channel,
      destination: normalizedValue,
      purpose: "password_reset",
      codeHashRef,
      createdAt: now,
      expiresAt: epochMillis(now + defaultCodePolicy.ttlMs),
      attempts: 0,
      maxAttempts: defaultCodePolicy.maxAttempts,
      ...(account !== undefined ? { accountId: account.id } : {}),
    };
    await this.deps.verifications.save(challenge);

    if (account !== undefined) {
      await this.deps.deliverer.deliver({
        channel: input.channel,
        destination: normalizedValue,
        code,
        purpose: "password_reset",
        challengeId,
      });
    }

    await this.deps.events.publish(
      domainEvent("auth.challenge.issued", now, {
        challengeId,
        purpose: "password_reset",
        ...(account !== undefined ? { accountId: account.id } : {}),
      }),
    );

    return ok({ challengeId });
  }

  async resetPassword(input: {
    readonly challengeId: ChallengeId;
    readonly code: string;
    readonly newPassword: string;
  }): Promise<AuthResult<void>> {
    const challenge = await this.deps.verifications.findById(input.challengeId);
    if (challenge === undefined || challenge.purpose !== "password_reset") {
      return err(authError("CODE_INVALID", "Invalid or unknown code."));
    }

    if (!isPasswordAcceptable(input.newPassword, this.passwordPolicy)) {
      return err(authError("WEAK_PASSWORD", describePasswordPolicy(this.passwordPolicy)));
    }

    const now = this.deps.clock.now();
    const consumption = await consumeChallenge(challenge, input.code, this.deps.hasher, now);
    if (!consumption.ok) {
      await this.deps.verifications.save({ ...challenge, attempts: challenge.attempts + 1 });
      return err(consumption.error);
    }
    await this.deps.verifications.save(consumption.value);

    if (challenge.accountId === undefined) {
      return err(authError("CODE_INVALID", "This code is not linked to an account."));
    }

    const account = await this.deps.accounts.findById(challenge.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    const hashRef = await this.deps.hasher.hash(input.newPassword);
    const existing = await this.deps.credentials.findByKind(account.id, "password");

    const credential: PasswordCredential =
      existing !== undefined && existing.kind === "password"
        ? { ...existing, hashRef, updatedAt: now }
        : {
            id: asId(this.deps.ids.next()) as CredentialId,
            accountId: account.id,
            kind: "password",
            hashRef,
            createdAt: now,
            updatedAt: now,
          };
    await this.deps.credentials.save(credential);

    return ok(undefined);
  }

  async changePassword(input: {
    readonly accountId: AccountId;
    readonly currentPassword: string;
    readonly newPassword: string;
  }): Promise<AuthResult<void>> {
    const account = await this.deps.accounts.findById(input.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    const existing = await this.deps.credentials.findByKind(input.accountId, "password");
    if (existing === undefined || existing.kind !== "password") {
      return err(authError("INVALID_CREDENTIALS", "Invalid credentials."));
    }

    const valid = await this.deps.hasher.verify(input.currentPassword, existing.hashRef);
    if (!valid) {
      return err(authError("INVALID_CREDENTIALS", "Invalid credentials."));
    }

    if (!isPasswordAcceptable(input.newPassword, this.passwordPolicy)) {
      return err(authError("WEAK_PASSWORD", describePasswordPolicy(this.passwordPolicy)));
    }

    const now = this.deps.clock.now();
    const hashRef = await this.deps.hasher.hash(input.newPassword);
    await this.deps.credentials.save({ ...existing, hashRef, updatedAt: now });

    return ok(undefined);
  }
}
