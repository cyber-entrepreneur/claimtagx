import type { AccountId, CredentialId } from "../domain/ids.js";
import type { Account } from "../domain/account.js";
import { normalizeIdentifier } from "../domain/account.js";
import type { SocialCredential, SocialProvider } from "../domain/credential.js";
import type { Clock, EpochMillis, IdGenerator } from "../shared/clock.js";
import type { EventPublisher } from "../shared/events.js";
import { domainEvent } from "../shared/events.js";
import type { SecureRandom } from "../shared/random.js";
import { authError, err, ok } from "../shared/result.js";
import { asId } from "../shared/ids.js";
import type { AuthResult, LoginOutcome, RequestContext, SocialService } from "../ports/inbound.js";
import type {
  AccountRepository,
  CredentialRepository,
  OAuthClient,
  SessionRepository,
  TokenService,
} from "../ports/outbound.js";
import { assertAccountUsable, availableMfaMethods, issueAuthenticatedSession } from "./session-support.js";

const STATE_TTL_MS = 10 * 60 * 1000;

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Minimal base64url encoder so we never need a Node/WebCrypto `Buffer` import here. */
const toBase64Url = (bytes: Uint8Array): string => {
  let result = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const chunk = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    result += BASE64URL_ALPHABET[(chunk >> 18) & 0x3f];
    result += BASE64URL_ALPHABET[(chunk >> 12) & 0x3f];
    result += BASE64URL_ALPHABET[(chunk >> 6) & 0x3f];
    result += BASE64URL_ALPHABET[chunk & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i]! << 16;
    result += BASE64URL_ALPHABET[(chunk >> 18) & 0x3f];
    result += BASE64URL_ALPHABET[(chunk >> 12) & 0x3f];
  } else if (remaining === 2) {
    const chunk = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    result += BASE64URL_ALPHABET[(chunk >> 18) & 0x3f];
    result += BASE64URL_ALPHABET[(chunk >> 12) & 0x3f];
    result += BASE64URL_ALPHABET[(chunk >> 6) & 0x3f];
  }
  return result;
};

interface PendingOAuthState {
  readonly provider: SocialProvider;
  readonly createdAt: EpochMillis;
}

export interface SocialServiceDeps {
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly sessions: SessionRepository;
  readonly tokens: TokenService;
  readonly oauth: OAuthClient;
  readonly random: SecureRandom;
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class SocialServiceImpl implements SocialService {
  private readonly pendingStates = new Map<string, PendingOAuthState>();

  constructor(private readonly deps: SocialServiceDeps) {}

  async begin(input: {
    readonly provider: SocialProvider;
    readonly redirectUri: string;
  }): Promise<AuthResult<{ authorizationUrl: string; state: string }>> {
    const state = toBase64Url(this.deps.random.bytes(16));
    this.pendingStates.set(state, { provider: input.provider, createdAt: this.deps.clock.now() });

    const authorizationUrl = this.deps.oauth.authorizationUrl({
      provider: input.provider,
      state,
      redirectUri: input.redirectUri,
    });

    return ok({ authorizationUrl, state });
  }

  async complete(input: {
    readonly provider: SocialProvider;
    readonly code: string;
    readonly state: string;
    readonly redirectUri: string;
    readonly context?: RequestContext;
  }): Promise<AuthResult<LoginOutcome>> {
    const pending = this.pendingStates.get(input.state);
    const now = this.deps.clock.now();
    if (pending === undefined || pending.provider !== input.provider || now - pending.createdAt > STATE_TTL_MS) {
      return err(authError("SOCIAL_EXCHANGE_FAILED", "Invalid or expired OAuth state."));
    }
    this.pendingStates.delete(input.state);

    let profile;
    try {
      profile = await this.deps.oauth.exchangeCode({
        provider: input.provider,
        code: input.code,
        redirectUri: input.redirectUri,
      });
    } catch {
      return err(authError("SOCIAL_EXCHANGE_FAILED", "Failed to exchange authorization code."));
    }

    const existingSocialCredential = await this.deps.credentials.findBySocialSubject(
      input.provider,
      profile.subject,
    );

    let account: Account | undefined;

    if (existingSocialCredential !== undefined) {
      account = await this.deps.accounts.findById(existingSocialCredential.accountId);
      if (account === undefined) {
        return err(authError("ACCOUNT_NOT_FOUND", "No account with that id exists."));
      }
    } else if (profile.email !== undefined && profile.emailVerified === true) {
      const normalizedEmail = normalizeIdentifier("email", profile.email);
      const matchedAccount = await this.deps.accounts.findByIdentifier("email", normalizedEmail);
      if (matchedAccount !== undefined) {
        account = matchedAccount;
        const linkedCredential: SocialCredential = {
          id: asId(this.deps.ids.next()) as CredentialId,
          accountId: matchedAccount.id,
          kind: "social",
          provider: input.provider,
          subject: profile.subject,
          createdAt: now,
        };
        await this.deps.credentials.save(linkedCredential);
      }
    }

    if (account === undefined) {
      const accountId = asId(this.deps.ids.next()) as AccountId;
      const normalizedEmail = profile.email !== undefined ? normalizeIdentifier("email", profile.email) : undefined;
      const newAccount: Account = {
        id: accountId,
        identifiers:
          normalizedEmail !== undefined
            ? [{ kind: "email", value: normalizedEmail, verified: profile.emailVerified === true }]
            : [],
        status: "active",
        mfaRequired: false,
        createdAt: now,
      };
      await this.deps.accounts.save(newAccount);

      const newCredential: SocialCredential = {
        id: asId(this.deps.ids.next()) as CredentialId,
        accountId,
        kind: "social",
        provider: input.provider,
        subject: profile.subject,
        createdAt: now,
      };
      await this.deps.credentials.save(newCredential);

      await this.deps.events.publish(domainEvent("auth.account.registered", now, { accountId }));
      account = newAccount;
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

    const outcome = await issueAuthenticatedSession(
      this.deps,
      account,
      input.context,
      `social:${input.provider}`,
    );
    return ok(outcome);
  }
}
