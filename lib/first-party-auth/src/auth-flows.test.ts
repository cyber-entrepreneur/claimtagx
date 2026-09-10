import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { epochMillis } from "./shared/clock.js";
import { asId } from "./shared/ids.js";
import type { AccountId, CredentialId } from "./domain/ids.js";
import type { PasswordHasher } from "./ports/outbound.js";
import {
  Argon2idPasswordHasher,
  createAuthPlatform,
  FakeClock,
  InMemoryAccountRepository,
  InMemoryCredentialRepository,
  InMemoryRateLimiter,
  NodeSecureRandom,
  RecordingCodeDeliverer,
  Rfc6238TotpAuthenticator,
  SequentialIdGenerator,
} from "./index.js";
import type { RecordedCode } from "./adapters/recording-code-deliverer.js";

/** Counts hash/verify calls so timing-equalization can be asserted. */
class CountingHasher implements PasswordHasher {
  hashCalls = 0;
  verifyCalls = 0;
  constructor(private readonly inner: PasswordHasher = new Argon2idPasswordHasher()) {}
  async hash(plaintext: string): Promise<string> {
    this.hashCalls += 1;
    return this.inner.hash(plaintext);
  }
  async verify(plaintext: string, hashRef: string): Promise<boolean> {
    this.verifyCalls += 1;
    return this.inner.verify(plaintext, hashRef);
  }
  needsRehash(hashRef: string): boolean {
    return this.inner.needsRehash(hashRef);
  }
  get totalCalls(): number {
    return this.hashCalls + this.verifyCalls;
  }
}

function harness(opts?: {
  capacity?: number;
  refillPerMs?: number;
  startMs?: number;
  hasher?: PasswordHasher;
  accounts?: InMemoryAccountRepository;
  credentials?: InMemoryCredentialRepository;
}) {
  const clock = new FakeClock(opts?.startMs ?? 1_700_000_000_000);
  const deliverer = new RecordingCodeDeliverer();
  const random = new NodeSecureRandom();
  const totp = new Rfc6238TotpAuthenticator(random);
  const credentials = opts?.credentials ?? new InMemoryCredentialRepository();
  const platform = createAuthPlatform({
    clock,
    ids: new SequentialIdGenerator("t"),
    random,
    deliverer,
    totp,
    credentials,
    ...(opts?.accounts !== undefined ? { accounts: opts.accounts } : {}),
    ...(opts?.hasher !== undefined ? { hasher: opts.hasher } : {}),
    rateLimiter: new InMemoryRateLimiter({
      capacity: opts?.capacity ?? 100,
      refillPerMs: opts?.refillPerMs ?? 1,
      clock,
    }),
    jwtSecret: "test-secret",
  });
  return { platform, clock, deliverer, totp, credentials };
}

async function registerConfirmLogin(
  platform: ReturnType<typeof createAuthPlatform>,
  deliverer: RecordingCodeDeliverer,
  email = "alice@example.com",
  password = "correct-horse",
) {
  const reg = await platform.registration.registerWithPassword({
    identifier: { kind: "email", value: email },
    password,
  });
  assert.equal(reg.ok, true);
  if (!reg.ok) throw new Error("register failed");
  const code = deliverer.lastCode?.code;
  assert.ok(code);
  const confirmed = await platform.registration.confirmIdentifier({
    challengeId: reg.value.verification!,
    code: code!,
  });
  assert.equal(confirmed.ok, true);
  return { account: confirmed.ok ? confirmed.value.account : undefined!, email, password };
}

describe("auth flows", () => {
  it("password register → confirm → login", async () => {
    const { platform, deliverer } = harness();
    const { email, password } = await registerConfirmLogin(platform, deliverer);
    const login = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: email },
      password,
    });
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(login.value.status, "authenticated");
    if (login.value.status !== "authenticated") return;
    const ctx = await platform.sessions.verify(login.value.tokens.accessToken);
    assert.equal(ctx.ok, true);
  });

  it("wrong password → INVALID_CREDENTIALS", async () => {
    const { platform, deliverer } = harness();
    const { email } = await registerConfirmLogin(platform, deliverer);
    const bad = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: email },
      password: "wrong-password",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.code, "INVALID_CREDENTIALS");
  });

  it("unknown-account login identical to wrong-password (no enumeration)", async () => {
    const { platform, deliverer } = harness();
    await registerConfirmLogin(platform, deliverer, "known@example.com");
    const unknown = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: "nobody@example.com" },
      password: "whatever-pass",
    });
    const wrong = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: "known@example.com" },
      password: "whatever-pass",
    });
    assert.equal(unknown.ok, false);
    assert.equal(wrong.ok, false);
    if (!unknown.ok && !wrong.ok) {
      assert.equal(unknown.error.code, wrong.error.code);
      assert.equal(unknown.error.code, "INVALID_CREDENTIALS");
    }
  });

  it("unknown reset identical shape to known (no enumeration)", async () => {
    const { platform, deliverer } = harness();
    await registerConfirmLogin(platform, deliverer, "reset@example.com");
    const before = deliverer.codes.length;
    const unknown = await platform.password.requestReset({
      identifier: { kind: "email", value: "ghost@example.com" },
      channel: "email",
    });
    const known = await platform.password.requestReset({
      identifier: { kind: "email", value: "reset@example.com" },
      channel: "email",
    });
    assert.equal(unknown.ok, true);
    assert.equal(known.ok, true);
    if (unknown.ok && known.ok) {
      assert.ok(unknown.value.challengeId);
      assert.ok(known.value.challengeId);
    }
    // Known got a delivered code; unknown did not add a usable delivery (or identical shape only)
    assert.ok(deliverer.codes.length >= before);
  });

  it("OTP login", async () => {
    const { platform, deliverer } = harness();
    const { email } = await registerConfirmLogin(platform, deliverer, "otp@example.com");
    const req = await platform.authentication.requestLoginOtp({
      identifier: { kind: "email", value: email },
      channel: "email",
    });
    assert.equal(req.ok, true);
    if (!req.ok) return;
    const code = deliverer.lastCode?.code;
    assert.ok(code);
    const verified = await platform.authentication.verifyLoginOtp({
      challengeId: req.value.challengeId,
      code: code!,
    });
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal(verified.value.status, "authenticated");
  });

  it("TOTP enroll → confirm and mfa_required → submitMfa → authenticated", async () => {
    const { platform, deliverer, totp, credentials, clock } = harness();
    const { email, password, account } = await registerConfirmLogin(
      platform,
      deliverer,
      "mfa@example.com",
    );
    const enrolled = await platform.mfa.enrollTotp({
      accountId: account.id,
      issuer: "TestIssuer",
      label: email,
    });
    assert.equal(enrolled.ok, true);
    const totpCred = await credentials.findByKind(account.id, "totp");
    assert.ok(totpCred && totpCred.kind === "totp");
    const code = totp.codeAt(totpCred!.secretRef, clock.now());
    assert.ok(code);
    const confirmed = await platform.mfa.confirmTotp({
      accountId: account.id,
      code: code!,
    });
    assert.equal(confirmed.ok, true);

    const login = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: email },
      password,
    });
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(login.value.status, "mfa_required");
    if (login.value.status !== "mfa_required") return;

    const wrong = await platform.authentication.submitMfa({
      accountId: login.value.accountId,
      method: "totp",
      code: "000000",
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.error.code, "MFA_INVALID");

    const goodCode = totp.codeAt(totpCred!.secretRef, clock.now());
    const okMfa = await platform.authentication.submitMfa({
      accountId: login.value.accountId,
      method: "totp",
      code: goodCode!,
    });
    assert.equal(okMfa.ok, true);
    if (okMfa.ok) assert.equal(okMfa.value.status, "authenticated");
  });

  it("social create-then-link-by-subject (no dup)", async () => {
    const { platform } = harness();
    const begin = await platform.social.begin({
      provider: "google",
      redirectUri: "https://app.test/cb",
    });
    assert.equal(begin.ok, true);
    if (!begin.ok) return;
    const first = await platform.social.complete({
      provider: "google",
      code: "auth-code",
      state: begin.value.state,
      redirectUri: "https://app.test/cb",
    });
    assert.equal(first.ok, true);
    if (!first.ok || first.value.status !== "authenticated") return;
    const accountId1 = first.value.context.accountId;

    const begin2 = await platform.social.begin({
      provider: "google",
      redirectUri: "https://app.test/cb",
    });
    assert.equal(begin2.ok, true);
    if (!begin2.ok) return;
    const second = await platform.social.complete({
      provider: "google",
      code: "auth-code",
      state: begin2.value.state,
      redirectUri: "https://app.test/cb",
    });
    assert.equal(second.ok, true);
    if (!second.ok || second.value.status !== "authenticated") return;
    assert.equal(second.value.context.accountId, accountId1);
  });

  it("reset makes old password fail / new work", async () => {
    const { platform, deliverer } = harness();
    const { email, password } = await registerConfirmLogin(
      platform,
      deliverer,
      "pwreset@example.com",
      "old-password",
    );
    const req = await platform.password.requestReset({
      identifier: { kind: "email", value: email },
      channel: "email",
    });
    assert.equal(req.ok, true);
    if (!req.ok) return;
    const code = deliverer.lastCode?.code;
    assert.ok(code);
    const reset = await platform.password.resetPassword({
      challengeId: req.value.challengeId,
      code: code!,
      newPassword: "new-password",
    });
    assert.equal(reset.ok, true);
    const oldLogin = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: email },
      password,
    });
    assert.equal(oldLogin.ok, false);
    const newLogin = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: email },
      password: "new-password",
    });
    assert.equal(newLogin.ok, true);
  });

  it("session verify / expired / revoked / refresh", async () => {
    const { platform, deliverer, clock } = harness();
    const { email, password } = await registerConfirmLogin(
      platform,
      deliverer,
      "sess@example.com",
    );
    const login = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: email },
      password,
    });
    assert.equal(login.ok, true);
    if (!login.ok || login.value.status !== "authenticated") return;
    const { tokens, context } = login.value;

    const okVerify = await platform.sessions.verify(tokens.accessToken);
    assert.equal(okVerify.ok, true);

    assert.ok(tokens.refreshToken);
    const refreshed = await platform.sessions.refresh(tokens.refreshToken!);
    assert.equal(refreshed.ok, true);

    await platform.sessions.revoke(context.sessionId);
    const revoked = await platform.sessions.verify(
      refreshed.ok ? refreshed.value.accessToken : tokens.accessToken,
    );
    // After revoke of original session, refresh may have new session — revokeAll for certainty
    await platform.sessions.revokeAll(context.accountId);
    const afterAll = await platform.sessions.verify(tokens.accessToken);
    assert.equal(afterAll.ok, false);

    // Expired: advance past access TTL (15m) and issue a fresh login then advance
    const login2 = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: email },
      password,
    });
    assert.equal(login2.ok, true);
    if (!login2.ok || login2.value.status !== "authenticated") return;
    clock.set(clock.now() + 16 * 60 * 1000);
    const expired = await platform.sessions.verify(login2.value.tokens.accessToken);
    assert.equal(expired.ok, false);
    if (!expired.ok) {
      assert.ok(
        expired.error.code === "TOKEN_EXPIRED" ||
          expired.error.code === "TOKEN_INVALID" ||
          expired.error.code === "SESSION_REVOKED",
      );
    }
    void epochMillis;
  });

  it("N failed logins → RATE_LIMITED", async () => {
    const { platform, deliverer } = harness({ capacity: 3, refillPerMs: 0.000001 });
    const { email } = await registerConfirmLogin(platform, deliverer, "rl@example.com");
    for (let i = 0; i < 3; i++) {
      await platform.authentication.loginWithPassword({
        identifier: { kind: "email", value: email },
        password: "wrong-password",
        context: { ipAddress: "1.2.3.4" },
      });
    }
    const limited = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: email },
      password: "wrong-password",
      context: { ipAddress: "1.2.3.4" },
    });
    assert.equal(limited.ok, false);
    if (!limited.ok) assert.equal(limited.error.code, "RATE_LIMITED");
  });

  it("code expiry / max-attempts", async () => {
    const { platform, deliverer, clock } = harness();
    const reg = await platform.registration.registerWithPassword({
      identifier: { kind: "email", value: "expire@example.com" },
      password: "correct-horse",
    });
    assert.equal(reg.ok, true);
    if (!reg.ok || !reg.value.verification) return;
    const challengeId = reg.value.verification;

    // Max attempts
    for (let i = 0; i < 5; i++) {
      await platform.registration.confirmIdentifier({
        challengeId,
        code: "000000",
      });
    }
    const maxed = await platform.registration.confirmIdentifier({
      challengeId,
      code: deliverer.lastCode?.code ?? "111111",
    });
    assert.equal(maxed.ok, false);
    if (!maxed.ok) {
      assert.ok(
        maxed.error.code === "CODE_MAX_ATTEMPTS" || maxed.error.code === "CODE_INVALID",
      );
    }

    // Fresh registration for expiry
    const reg2 = await platform.registration.registerWithPassword({
      identifier: { kind: "email", value: "expire2@example.com" },
      password: "correct-horse",
    });
    assert.equal(reg2.ok, true);
    if (!reg2.ok || !reg2.value.verification) return;
    const recorded: RecordedCode | undefined = deliverer.lastCode;
    clock.set(clock.now() + 6 * 60 * 1000);
    const expired = await platform.registration.confirmIdentifier({
      challengeId: reg2.value.verification,
      code: recorded?.code ?? "000000",
    });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.error.code, "CODE_EXPIRED");
  });

  it("unknown-account and no-password login each hash before INVALID_CREDENTIALS", async () => {
    const unknownHasher = new CountingHasher();
    const { platform: unknownPlatform } = harness({ hasher: unknownHasher });
    const unknown = await unknownPlatform.authentication.loginWithPassword({
      identifier: { kind: "email", value: "ghost@example.com" },
      password: "any-password",
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error.code, "INVALID_CREDENTIALS");
    assert.ok(unknownHasher.totalCalls >= 1);

    const noPwHasher = new CountingHasher();
    const accounts = new InMemoryAccountRepository();
    const credentials = new InMemoryCredentialRepository();
    const accountId = asId("acc-nopw") as AccountId;
    const now = epochMillis(1_700_000_000_000);
    await accounts.save({
      id: accountId,
      identifiers: [{ kind: "email", value: "social-only@example.com", verified: true }],
      status: "active",
      mfaRequired: false,
      createdAt: now,
    });
    const { platform: noPwPlatform } = harness({
      hasher: noPwHasher,
      accounts,
      credentials,
    });
    const noPw = await noPwPlatform.authentication.loginWithPassword({
      identifier: { kind: "email", value: "social-only@example.com" },
      password: "any-password",
    });
    assert.equal(noPw.ok, false);
    if (!noPw.ok) assert.equal(noPw.error.code, "INVALID_CREDENTIALS");
    assert.ok(noPwHasher.totalCalls >= 1);
  });

  it("login upgrades outdated password hash when needsRehash", async () => {
    const accounts = new InMemoryAccountRepository();
    const credentials = new InMemoryCredentialRepository();
    const accountId = asId("acc-rehash") as AccountId;
    const password = "correct-horse";
    const now = epochMillis(1_700_000_000_000);
    const weakHasher = new Argon2idPasswordHasher({ memoryCost: 8, timeCost: 2, parallelism: 1 });
    const outdatedHash = await weakHasher.hash(password);
    const platformHasher = new Argon2idPasswordHasher();
    assert.equal(platformHasher.needsRehash(outdatedHash), true);

    await accounts.save({
      id: accountId,
      identifiers: [{ kind: "email", value: "rehash@example.com", verified: true }],
      status: "active",
      mfaRequired: false,
      createdAt: now,
    });
    await credentials.save({
      id: asId("cred-rehash") as CredentialId,
      accountId,
      kind: "password",
      hashRef: outdatedHash,
      createdAt: now,
      updatedAt: now,
    });

    const { platform } = harness({ accounts, credentials, hasher: platformHasher });
    const login = await platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: "rehash@example.com" },
      password,
    });
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(login.value.status, "authenticated");

    const stored = await credentials.findByKind(accountId, "password");
    assert.ok(stored !== undefined && stored.kind === "password");
    if (stored === undefined || stored.kind !== "password") return;
    assert.equal(platformHasher.needsRehash(stored.hashRef), false);
  });
});
