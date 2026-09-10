import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
// Imported via relative path (not the `@workspace/first-party-auth` alias) so the
// test runs under `tsx --test` without depending on workspace symlinks — the same
// convention used by `../crm/openapiContract.test.ts`.
import {
  createAuthPlatform,
  FakeClock,
  RecordingCodeDeliverer,
  type AuthPlatform,
} from "../../../../../lib/first-party-auth/src/index.ts";

/**
 * Unit-level coverage for the first-party auth CORE using the in-memory platform
 * (no DATABASE_URL required). The production HTTP composition
 * (`composeAuthPlatform.ts`) wires the SAME application services onto Postgres +
 * OpaqueTokenService, so these behavioural guarantees carry over.
 *
 * Covered:
 *   1. login success + failure enumeration safety (unknown vs wrong-password)
 *   2. session rotation on refresh
 *   3. password reset one-time code is single-use
 */

const EMAIL = "owner@example.com";
const PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "another-strong-passphrase";

interface Harness {
  readonly platform: AuthPlatform;
  readonly deliverer: RecordingCodeDeliverer;
  readonly clock: FakeClock;
}

function makeHarness(): Harness {
  const clock = new FakeClock(1_700_000_000_000);
  const deliverer = new RecordingCodeDeliverer();
  const platform = createAuthPlatform({ clock, deliverer });
  return { platform, deliverer, clock };
}

/** Register + verify an ACTIVE email/password account, returning its id. */
async function provisionActiveAccount(h: Harness): Promise<string> {
  const reg = await h.platform.registration.registerWithPassword({
    identifier: { kind: "email", value: EMAIL },
    password: PASSWORD,
  });
  assert.ok(reg.ok, "registration should succeed");
  const challengeId = reg.value.verification;
  assert.ok(challengeId, "email registration should issue a verification challenge");

  const code = h.deliverer.lastCode?.code;
  assert.ok(code, "a verification code should have been delivered");

  const confirmed = await h.platform.registration.confirmIdentifier({
    challengeId,
    code: code!,
  });
  assert.ok(confirmed.ok, "identifier confirmation should succeed");
  assert.equal(confirmed.value.account.status, "active");
  return confirmed.value.account.id as string;
}

describe("first-party auth platform (in-memory)", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("logs in with the correct password and issues a rotating token pair", async () => {
    await provisionActiveAccount(h);
    const result = await h.platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: EMAIL },
      password: PASSWORD,
    });
    assert.ok(result.ok, "login with correct credentials should succeed");
    assert.equal(result.value.status, "authenticated");
    if (result.value.status !== "authenticated") return;
    assert.ok(result.value.tokens.accessToken.length > 0);
    assert.ok(result.value.tokens.refreshToken.length > 0);
  });

  it("does not leak account existence (enumeration safety)", async () => {
    await provisionActiveAccount(h);

    const wrongPassword = await h.platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: EMAIL },
      password: "totally-wrong-password",
    });
    const unknownEmail = await h.platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: "nobody@example.com" },
      password: PASSWORD,
    });

    // Both must fail as VALUES (never throw) and neither may echo the identifier
    // or reveal whether the account exists.
    assert.equal(wrongPassword.ok, false);
    assert.equal(unknownEmail.ok, false);
    if (wrongPassword.ok || unknownEmail.ok) return;
    assert.equal(wrongPassword.error.code, unknownEmail.error.code);
    assert.doesNotMatch(wrongPassword.error.message, /nobody@example\.com|owner@example\.com/);
    assert.doesNotMatch(unknownEmail.error.message, /nobody@example\.com|owner@example\.com/);
    assert.doesNotMatch(unknownEmail.error.message, /not.?found|no.?such|unknown account/i);
  });

  it("rotates the session on refresh", async () => {
    await provisionActiveAccount(h);
    const login = await h.platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: EMAIL },
      password: PASSWORD,
    });
    assert.ok(login.ok && login.value.status === "authenticated");
    if (!login.ok || login.value.status !== "authenticated") return;
    const firstRefresh = login.value.tokens.refreshToken;

    // Advance time so the rotated token is materially different from the first.
    h.clock.advance(1_000);
    const refreshed = await h.platform.sessions.refresh(firstRefresh);
    assert.ok(refreshed.ok, "refresh with a valid token should succeed");
    if (!refreshed.ok) return;

    assert.notEqual(refreshed.value.refreshToken, firstRefresh, "refresh token must rotate");
    const verify = await h.platform.sessions.verify(refreshed.value.accessToken);
    assert.ok(verify.ok, "the newly minted access token must verify");
  });

  it("consumes a password-reset code exactly once (single-use)", async () => {
    await provisionActiveAccount(h);

    const request = await h.platform.password.requestReset({
      identifier: { kind: "email", value: EMAIL },
      channel: "email",
    });
    assert.ok(request.ok, "reset request should succeed");
    if (!request.ok) return;
    const challengeId = request.value.challengeId;

    const resetCode = h.deliverer.lastCode?.code;
    assert.ok(resetCode, "a reset code should have been delivered");

    const first = await h.platform.password.resetPassword({
      challengeId,
      code: resetCode!,
      newPassword: NEW_PASSWORD,
    });
    assert.ok(first.ok, "first reset with a valid code should succeed");

    const second = await h.platform.password.resetPassword({
      challengeId,
      code: resetCode!,
      newPassword: "yet-another-password",
    });
    assert.equal(second.ok, false, "the code must not be reusable");

    // The new password works; the old one no longer does.
    const withNew = await h.platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: EMAIL },
      password: NEW_PASSWORD,
    });
    assert.ok(withNew.ok && withNew.value.status === "authenticated");

    const withOld = await h.platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: EMAIL },
      password: PASSWORD,
    });
    assert.equal(withOld.ok, false, "the old password must be rejected after reset");
  });
});
