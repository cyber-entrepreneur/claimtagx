import type { AccountId, ChallengeId, CredentialId } from "../domain/ids.js";
import type { Account, Identifier } from "../domain/account.js";
import { normalizeIdentifier } from "../domain/account.js";
import type { PasswordCredential } from "../domain/credential.js";
import type { CodePolicy, DeliveryChannel, VerificationChallenge } from "../domain/verification.js";
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
import type { AuthResult, RegistrationService, RequestContext } from "../ports/inbound.js";
import type {
  AccountRepository,
  CodeDeliverer,
  CredentialRepository,
  PasswordHasher,
  VerificationRepository,
} from "../ports/outbound.js";
import { consumeChallenge, generateNumericCode } from "./session-support.js";

export interface RegistrationServiceDeps {
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly verifications: VerificationRepository;
  readonly hasher: PasswordHasher;
  readonly deliverer: CodeDeliverer;
  readonly random: SecureRandom;
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly codePolicy?: CodePolicy;
  readonly passwordPolicy?: PasswordPolicy;
}

/** Identifier kinds that can actually receive a delivered code. */
const deliveryChannelForKind = (kind: Identifier["kind"]): DeliveryChannel | undefined => {
  switch (kind) {
    case "email":
      return "email";
    case "phone":
      return "sms";
    case "username":
      return undefined;
  }
};

const channelToIdentifierKind = (channel: DeliveryChannel): Identifier["kind"] =>
  channel === "email" ? "email" : "phone";

export class RegistrationServiceImpl implements RegistrationService {
  private readonly codePolicy: CodePolicy;
  private readonly passwordPolicy: PasswordPolicy;

  constructor(private readonly deps: RegistrationServiceDeps) {
    this.codePolicy = deps.codePolicy ?? defaultCodePolicy;
    this.passwordPolicy = deps.passwordPolicy ?? defaultPasswordPolicy;
  }

  async registerWithPassword(input: {
    readonly identifier: { readonly kind: Identifier["kind"]; readonly value: string };
    readonly password: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<{ account: Account; verification?: ChallengeId }>> {
    const normalizedValue = normalizeIdentifier(input.identifier.kind, input.identifier.value);

    const existing = await this.deps.accounts.findByIdentifier(input.identifier.kind, normalizedValue);
    if (existing !== undefined) {
      return err(authError("IDENTIFIER_TAKEN", "This identifier is already registered."));
    }

    if (!isPasswordAcceptable(input.password, this.passwordPolicy)) {
      return err(authError("WEAK_PASSWORD", describePasswordPolicy(this.passwordPolicy)));
    }

    const now = this.deps.clock.now();
    const channel = deliveryChannelForKind(input.identifier.kind);
    const accountId = asId(this.deps.ids.next()) as AccountId;

    const identifier: Identifier = {
      kind: input.identifier.kind,
      value: normalizedValue,
      verified: channel === undefined,
    };

    const account: Account = {
      id: accountId,
      identifiers: [identifier],
      status: channel === undefined ? "active" : "pending",
      mfaRequired: false,
      createdAt: now,
    };
    await this.deps.accounts.save(account);

    const hashRef = await this.deps.hasher.hash(input.password);
    const credential: PasswordCredential = {
      id: asId(this.deps.ids.next()) as CredentialId,
      accountId,
      kind: "password",
      hashRef,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.credentials.save(credential);

    await this.deps.events.publish(domainEvent("auth.account.registered", now, { accountId }));

    if (channel === undefined) {
      return ok({ account });
    }

    const code = generateNumericCode(this.deps.random, this.codePolicy.length);
    const codeHashRef = await this.deps.hasher.hash(code);
    const challengeId = asId(this.deps.ids.next()) as ChallengeId;
    const challenge: VerificationChallenge = {
      id: challengeId,
      accountId,
      channel,
      destination: normalizedValue,
      purpose: "identifier_verify",
      codeHashRef,
      createdAt: now,
      expiresAt: epochMillis(now + this.codePolicy.ttlMs),
      attempts: 0,
      maxAttempts: this.codePolicy.maxAttempts,
    };
    await this.deps.verifications.save(challenge);
    await this.deps.deliverer.deliver({
      channel,
      destination: normalizedValue,
      code,
      purpose: "identifier_verify",
      challengeId,
    });

    await this.deps.events.publish(
      domainEvent("auth.challenge.issued", now, {
        challengeId,
        purpose: "identifier_verify",
        accountId,
      }),
    );

    return ok({ account, verification: challengeId });
  }

  async startIdentifierVerification(input: {
    readonly accountId: AccountId;
    readonly kind: Identifier["kind"];
    readonly value: string;
    readonly channel: DeliveryChannel;
  }): Promise<AuthResult<{ challengeId: ChallengeId }>> {
    const account = await this.deps.accounts.findById(input.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    const now = this.deps.clock.now();
    const normalizedValue = normalizeIdentifier(input.kind, input.value);
    const code = generateNumericCode(this.deps.random, this.codePolicy.length);
    const codeHashRef = await this.deps.hasher.hash(code);
    const challengeId = asId(this.deps.ids.next()) as ChallengeId;

    const challenge: VerificationChallenge = {
      id: challengeId,
      accountId: input.accountId,
      channel: input.channel,
      destination: normalizedValue,
      purpose: "identifier_verify",
      codeHashRef,
      createdAt: now,
      expiresAt: epochMillis(now + this.codePolicy.ttlMs),
      attempts: 0,
      maxAttempts: this.codePolicy.maxAttempts,
    };
    await this.deps.verifications.save(challenge);
    await this.deps.deliverer.deliver({
      channel: input.channel,
      destination: normalizedValue,
      code,
      purpose: "identifier_verify",
      challengeId,
    });

    await this.deps.events.publish(
      domainEvent("auth.challenge.issued", now, {
        challengeId,
        purpose: "identifier_verify",
        accountId: input.accountId,
      }),
    );

    return ok({ challengeId });
  }

  async confirmIdentifier(input: {
    readonly challengeId: ChallengeId;
    readonly code: string;
  }): Promise<AuthResult<{ account: Account }>> {
    const challenge = await this.deps.verifications.findById(input.challengeId);
    if (challenge === undefined || challenge.purpose !== "identifier_verify") {
      return err(authError("CODE_INVALID", "Invalid or unknown verification code."));
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

    const kind = channelToIdentifierKind(challenge.channel);
    const alreadyPresent = account.identifiers.some(
      (i) => i.kind === kind && i.value === challenge.destination,
    );
    const identifiers = alreadyPresent
      ? account.identifiers.map((i) =>
          i.kind === kind && i.value === challenge.destination ? { ...i, verified: true } : i,
        )
      : [...account.identifiers, { kind, value: challenge.destination, verified: true }];

    const updatedAccount: Account = {
      ...account,
      identifiers,
      status: account.status === "pending" ? "active" : account.status,
    };
    await this.deps.accounts.save(updatedAccount);

    await this.deps.events.publish(
      domainEvent("auth.identifier.verified", now, { accountId: account.id, kind }),
    );

    return ok({ account: updatedAccount });
  }
}
