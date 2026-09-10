import type { AccountId, CredentialId } from "../domain/ids.js";
import type { Account } from "../domain/account.js";
import type { TotpCredential } from "../domain/credential.js";
import type { MfaMethod } from "../domain/mfa.js";
import type { Clock, IdGenerator } from "../shared/clock.js";
import type { EventPublisher } from "../shared/events.js";
import { domainEvent } from "../shared/events.js";
import type { SecureRandom } from "../shared/random.js";
import { authError, err, ok } from "../shared/result.js";
import { asId } from "../shared/ids.js";
import type { AuthResult, MfaService } from "../ports/inbound.js";
import type {
  AccountRepository,
  CredentialRepository,
  PasswordHasher,
  TotpAuthenticator,
} from "../ports/outbound.js";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generateRecoveryCode = (random: SecureRandom): string => {
  let code = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
    code += RECOVERY_ALPHABET[random.int(RECOVERY_ALPHABET.length)]!;
  }
  return code;
};

export interface MfaServiceDeps {
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly totp: TotpAuthenticator;
  readonly hasher: PasswordHasher;
  readonly random: SecureRandom;
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Whether an account currently has a confirmed TOTP credential enrolled. */
const hasConfirmedTotp = async (
  deps: MfaServiceDeps,
  accountId: AccountId,
): Promise<boolean> => {
  const credential = await deps.credentials.findByKind(accountId, "totp");
  return credential !== undefined && credential.kind === "totp" && credential.confirmedAt !== undefined;
};

export class MfaServiceImpl implements MfaService {
  constructor(private readonly deps: MfaServiceDeps) {}

  async enrollTotp(input: {
    readonly accountId: AccountId;
    readonly issuer: string;
    readonly label: string;
  }): Promise<AuthResult<{ otpauthUri: string }>> {
    const account = await this.deps.accounts.findById(input.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    const enrollment = await this.deps.totp.enroll({ issuer: input.issuer, label: input.label });
    const now = this.deps.clock.now();
    const credential: TotpCredential = {
      id: asId(this.deps.ids.next()) as CredentialId,
      accountId: input.accountId,
      kind: "totp",
      secretRef: enrollment.secretRef,
      createdAt: now,
    };
    await this.deps.credentials.save(credential);

    return ok({ otpauthUri: enrollment.otpauthUri });
  }

  async confirmTotp(input: {
    readonly accountId: AccountId;
    readonly code: string;
  }): Promise<AuthResult<void>> {
    const account = await this.deps.accounts.findById(input.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    const credential = await this.deps.credentials.findByKind(input.accountId, "totp");
    if (credential === undefined || credential.kind !== "totp") {
      return err(authError("MFA_INVALID", "No TOTP enrollment in progress for this account."));
    }

    const now = this.deps.clock.now();
    const valid = await this.deps.totp.verify(credential.secretRef, input.code, now);
    if (!valid) {
      return err(authError("MFA_INVALID", "Invalid authentication code."));
    }

    await this.deps.credentials.save({ ...credential, confirmedAt: now });

    const updatedAccount: Account = { ...account, mfaRequired: true };
    await this.deps.accounts.save(updatedAccount);

    await this.deps.events.publish(
      domainEvent("auth.mfa.enrolled", now, { accountId: input.accountId, method: "totp" }),
    );

    return ok(undefined);
  }

  async generateRecoveryCodes(input: {
    readonly accountId: AccountId;
  }): Promise<AuthResult<{ codes: readonly string[] }>> {
    const account = await this.deps.accounts.findById(input.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    const existing = await this.deps.credentials.findByKind(input.accountId, "recovery");
    if (existing !== undefined) {
      await this.deps.credentials.delete(existing.id);
    }

    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      codes.push(generateRecoveryCode(this.deps.random));
    }
    const codeHashes = await Promise.all(codes.map((code) => this.deps.hasher.hash(code)));

    const now = this.deps.clock.now();
    await this.deps.credentials.save({
      id: asId(this.deps.ids.next()) as CredentialId,
      accountId: input.accountId,
      kind: "recovery",
      codeHashes,
      createdAt: now,
    });

    return ok({ codes });
  }

  async disable(input: {
    readonly accountId: AccountId;
    readonly method: MfaMethod;
  }): Promise<AuthResult<void>> {
    const account = await this.deps.accounts.findById(input.accountId);
    if (account === undefined) {
      return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
    }

    if (input.method === "totp") {
      const credential = await this.deps.credentials.findByKind(input.accountId, "totp");
      if (credential !== undefined) {
        await this.deps.credentials.delete(credential.id);
      }
    } else if (input.method === "recovery") {
      const credential = await this.deps.credentials.findByKind(input.accountId, "recovery");
      if (credential !== undefined) {
        await this.deps.credentials.delete(credential.id);
      }
    } else {
      return err(authError("NOT_SUPPORTED", "This MFA method is not supported."));
    }

    const stillHasTotp = await hasConfirmedTotp(this.deps, input.accountId);
    if (!stillHasTotp && account.mfaRequired) {
      await this.deps.accounts.save({ ...account, mfaRequired: false });
    }

    return ok(undefined);
  }
}
