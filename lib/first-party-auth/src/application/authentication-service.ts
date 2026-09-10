import type { AccountId, ChallengeId } from "../domain/ids.js";
import type { Identifier } from "../domain/account.js";
import { normalizeIdentifier } from "../domain/account.js";
import type { MfaMethod } from "../domain/mfa.js";
import type { DeliveryChannel, VerificationChallenge } from "../domain/verification.js";
import { defaultCodePolicy } from "../domain/verification.js";
import type { Clock, IdGenerator } from "../shared/clock.js";
import { epochMillis } from "../shared/clock.js";
import type { EventPublisher } from "../shared/events.js";
import { domainEvent } from "../shared/events.js";
import type { SecureRandom } from "../shared/random.js";
import { authError, err, ok } from "../shared/result.js";
import { asId } from "../shared/ids.js";
import type {
  AuthenticationService,
  AuthResult,
  LoginOutcome,
  RequestContext,
} from "../ports/inbound.js";
import type {
  AccountRepository,
  CodeDeliverer,
  CredentialRepository,
  PasswordHasher,
  RateLimiter,
  SessionRepository,
  TokenService,
  TotpAuthenticator,
  VerificationRepository,
} from "../ports/outbound.js";
import {
  assertAccountUsable,
  availableMfaMethods,
  consumeChallenge,
  generateNumericCode,
  issueAuthenticatedSession,
} from "./session-support.js";

export interface AuthenticationServiceDeps {
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly sessions: SessionRepository;
  readonly verifications: VerificationRepository;
  readonly hasher: PasswordHasher;
  readonly totp: TotpAuthenticator;
  readonly deliverer: CodeDeliverer;
  readonly tokens: TokenService;
  readonly rateLimiter: RateLimiter;
  readonly random: SecureRandom;
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class AuthenticationServiceImpl implements AuthenticationService {
  constructor(private readonly deps: AuthenticationServiceDeps) {}

  async loginWithPassword(input: {
    readonly identifier: { readonly kind: Identifier["kind"]; readonly value: string };
    readonly password: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>> {
    const normalizedValue = normalizeIdentifier(input.identifier.kind, input.identifier.value);
    const rateLimitKey = `login:${input.context?.ipAddress ?? normalizedValue}`;
    const decision = await this.deps.rateLimiter.hit(rateLimitKey);
    if (!decision.allowed) {
      return err(
        authError("RATE_LIMITED", "Too many login attempts.", {
          retryAfterMs: decision.retryAfterMs,
        }),
      );
    }

    const account = await this.deps.accounts.findByIdentifier(input.identifier.kind, normalizedValue);
    if (account === undefined) {
      // Equalize timing with wrong-password path (which runs verify/hash work).
      await this.deps.hasher.hash(input.password);
      return err(authError("INVALID_CREDENTIALS", "Invalid credentials."));
    }

    const passwordCredential = await this.deps.credentials.findByKind(account.id, "password");
    if (passwordCredential === undefined || passwordCredential.kind !== "password") {
      await this.deps.hasher.hash(input.password);
      return err(authError("INVALID_CREDENTIALS", "Invalid credentials."));
    }

    const valid = await this.deps.hasher.verify(input.password, passwordCredential.hashRef);
    if (!valid) {
      return err(authError("INVALID_CREDENTIALS", "Invalid credentials."));
    }

    if (this.deps.hasher.needsRehash(passwordCredential.hashRef)) {
      const newHashRef = await this.deps.hasher.hash(input.password);
      await this.deps.credentials.save({
        ...passwordCredential,
        hashRef: newHashRef,
        updatedAt: this.deps.clock.now(),
      });
    }

    if (account.status === "pending") {
      return err(
        authError("IDENTIFIER_NOT_VERIFIED", "Please verify your identifier before logging in."),
      );
    }

    const now = this.deps.clock.now();
    const usable = assertAccountUsable(account, now);
    if (!usable.ok) {
      return err(usable.error);
    }

    if (account.mfaRequired) {
      const accountCredentials = await this.deps.credentials.listForAccount(account.id);
      return ok({
        status: "mfa_required",
        accountId: account.id,
        methods: availableMfaMethods(accountCredentials),
      });
    }

    const outcome = await issueAuthenticatedSession(this.deps, account, input.context, "password");
    return ok(outcome);
  }

  async requestLoginOtp(input: {
    readonly identifier: { readonly kind: Identifier["kind"]; readonly value: string };
    readonly channel: DeliveryChannel;
    readonly context?: RequestContext;
  }): Promise<AuthResult<{ challengeId: ChallengeId }>> {
    const normalizedValue = normalizeIdentifier(input.identifier.kind, input.identifier.value);
    const rateLimitKey = `otp:${input.context?.ipAddress ?? normalizedValue}`;
    const decision = await this.deps.rateLimiter.hit(rateLimitKey);
    if (!decision.allowed) {
      return err(
        authError("RATE_LIMITED", "Too many code requests.", {
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
      purpose: "login_otp",
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
        purpose: "login_otp",
        challengeId,
      });
    }

    await this.deps.events.publish(
      domainEvent("auth.challenge.issued", now, {
        challengeId,
        purpose: "login_otp",
        ...(account !== undefined ? { accountId: account.id } : {}),
      }),
    );

    return ok({ challengeId });
  }

  async verifyLoginOtp(input: {
    readonly challengeId: ChallengeId;
    readonly code: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>> {
    const challenge = await this.deps.verifications.findById(input.challengeId);
    if (challenge === undefined || challenge.purpose !== "login_otp") {
      return err(authError("CODE_INVALID", "Invalid or unknown code."));
    }

    const now = this.deps.clock.now();
    const consumption = await consumeChallenge(challenge, input.code, this.deps.hasher, now);
    if (!consumption.ok) {
      await this.deps.verifications.save({ ...challenge, attempts: challenge.attempts + 1 });
      return err(consumption.error);
    }
    await this.deps.verifications.save(consumption.value);

    if (challenge.accountId === undefined) {
      return err(authError("CODE_INVALID", "Invalid or unknown code."));
    }

    const account = await this.deps.accounts.findById(challenge.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    if (account.status === "pending") {
      return err(
        authError("IDENTIFIER_NOT_VERIFIED", "Please verify your identifier before logging in."),
      );
    }

    const usable = assertAccountUsable(account, now);
    if (!usable.ok) {
      return err(usable.error);
    }

    if (account.mfaRequired) {
      const accountCredentials = await this.deps.credentials.listForAccount(account.id);
      return ok({
        status: "mfa_required",
        accountId: account.id,
        methods: availableMfaMethods(accountCredentials),
      });
    }

    const outcome = await issueAuthenticatedSession(this.deps, account, input.context, "otp");
    return ok(outcome);
  }

  async submitMfa(input: {
    readonly accountId: AccountId;
    readonly method: MfaMethod;
    readonly code: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>> {
    const account = await this.deps.accounts.findById(input.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    const now = this.deps.clock.now();
    const usable = assertAccountUsable(account, now);
    if (!usable.ok) {
      return err(usable.error);
    }

    if (input.method === "totp") {
      const totpCredential = await this.deps.credentials.findByKind(input.accountId, "totp");
      if (
        totpCredential === undefined ||
        totpCredential.kind !== "totp" ||
        totpCredential.confirmedAt === undefined
      ) {
        return err(authError("MFA_INVALID", "TOTP is not enrolled for this account."));
      }
      const valid = await this.deps.totp.verify(totpCredential.secretRef, input.code, now);
      if (!valid) {
        return err(authError("MFA_INVALID", "Invalid authentication code."));
      }
    } else if (input.method === "recovery") {
      const recoveryCredential = await this.deps.credentials.findByKind(input.accountId, "recovery");
      if (recoveryCredential === undefined || recoveryCredential.kind !== "recovery") {
        return err(authError("MFA_INVALID", "No recovery codes available for this account."));
      }
      let matchedHash: string | undefined;
      for (const hash of recoveryCredential.codeHashes) {
        if (await this.deps.hasher.verify(input.code, hash)) {
          matchedHash = hash;
          break;
        }
      }
      if (matchedHash === undefined) {
        return err(authError("MFA_INVALID", "Invalid recovery code."));
      }
      await this.deps.credentials.save({
        ...recoveryCredential,
        codeHashes: recoveryCredential.codeHashes.filter((h) => h !== matchedHash),
      });
    } else {
      return err(authError("NOT_SUPPORTED", "This MFA method is not supported."));
    }

    const outcome = await issueAuthenticatedSession(
      this.deps,
      account,
      input.context,
      `mfa:${input.method}`,
    );
    return ok(outcome);
  }
}
