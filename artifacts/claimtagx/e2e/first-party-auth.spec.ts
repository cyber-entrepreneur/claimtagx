/**
 * Run against an isolated local API + built/previewed frontend:
 *   PLAYWRIGHT_QUALIFICATION=1 pnpm test:e2e -- --retries=0 e2e/first-party-auth.spec.ts
 *   CRM_E2E_API=http://127.0.0.1:18080, DATABASE_URL=<isolated 55432|55470 db>
 *   CRM_HTTP_TEST_AUTH=true is seed/setup-only if needed; primary journeys use password/login/MFA/invite/reset.
 *   Qualify across projects chrome/firefox/webkit (or the configured browser matrix).
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { assertApiAlive } from "./platformAuth";

const apiRoot = process.env.CRM_E2E_API ?? "http://127.0.0.1:18080";
const siteOrigin = (process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const AUTH_COOKIE = "ctx_auth_session";

type SeedStaff = {
  id: string;
  accountId: string;
  email: string;
  role: string;
  status: string;
  permissions: string[];
};

type SeedData = {
  password: string;
  resetPassword: string;
  owner: SeedStaff;
  staff: SeedStaff;
  resetStaff: SeedStaff;
  mfaStaff: SeedStaff;
  lowPrivilege: SeedStaff;
  pendingActivation: SeedStaff;
  suspended: SeedStaff;
  invite: { email: string; token: string };
  expiredInvite: { email: string; token: string };
  reset: { challengeId: string; code: string; token: string };
  expiredReset: { challengeId: string; code: string; token: string };
  invalidInviteToken: string;
  invalidResetToken: string;
  rateLimitedEmail: string;
  rateLimitKeys: string[];
};

function runAuthSeedScript(...args: string[]): Record<string, unknown> {
  const script = join(repoRoot, "artifacts/api-server/scripts/seed-first-party-auth-e2e.mts");
  const raw = execFileSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: join(repoRoot, "artifacts/api-server"),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    encoding: "utf8",
  });
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => l.startsWith("{"));
  if (!line) throw new Error(`seed-first-party-auth-e2e produced no JSON: ${raw.slice(0, 400)}`);
  return JSON.parse(line) as Record<string, unknown>;
}

function seedFirstPartyAuth(): SeedData {
  return runAuthSeedScript() as unknown as SeedData;
}

function clearLoginIpRateLimits(): void {
  runAuthSeedScript("--clear-login-ip");
}

function exhaustLoginIpRateLimits(): void {
  runAuthSeedScript("--exhaust-login-ip");
}

function headers(): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    origin: siteOrigin,
    referer: `${siteOrigin}/admin`,
  };
}

async function readJson(res: Awaited<ReturnType<APIRequestContext["fetch"]>>): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

async function loginApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ res: Awaited<ReturnType<APIRequestContext["post"]>>; body: Record<string, unknown> }> {
  const res = await request.post(`${apiRoot}/api/platform/auth/login`, {
    headers: headers(),
    data: { email, password },
  });
  return { res, body: await readJson(res) };
}

async function authedPost(
  page: Page,
  path: string,
  data: unknown = {},
): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  const res = await page.request.post(`${apiRoot}${path}`, {
    headers: headers(),
    data,
  });
  return { status: res.status(), headers: res.headers(), body: await readJson(res) };
}

async function expectNoBrowserSessionStorage(page: Page): Promise<void> {
  const stored = await page.evaluate((cookieName) => {
    const local: string[] = [];
    const session: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && /auth|token|session|ctx_auth/i.test(key)) local.push(`${key}=${window.localStorage.getItem(key)}`);
    }
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && /auth|token|session|ctx_auth/i.test(key)) {
        session.push(`${key}=${window.sessionStorage.getItem(key)}`);
      }
    }
    return {
      local: local.filter((entry) => entry.includes(cookieName)),
      session: session.filter((entry) => entry.includes(cookieName)),
    };
  }, AUTH_COOKIE);
  expect(stored.local).toEqual([]);
  expect(stored.session).toEqual([]);
}

function decodeBase32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/g, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function totpCode(secretBase32: string, now = Date.now()): string {
  const counter = Math.floor(Math.floor(now / 1000) / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secretBase32)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

function secretFromOtpauth(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error(`Missing TOTP secret in ${uri}`);
  return secret;
}

test.describe("first-party platform authentication", () => {
  test.skip(
    process.env.PLAYWRIGHT_QUALIFICATION !== "1",
    "Set PLAYWRIGHT_QUALIFICATION=1 with CRM_E2E_API and isolated DATABASE_URL",
  );

  let seed: SeedData;

  test.beforeAll(() => {
    seed = seedFirstPartyAuth();
  });

  test.beforeEach(async ({ page }) => {
    // AuthenticationService rate-limits by IP when present; never leave exhausted
    // localhost buckets across journeys.
    clearLoginIpRateLimits();
    await assertApiAlive(page);
    await page.context().clearCookies();
  });

  test("successful staff login uses an HttpOnly ctx_auth_session cookie and no browser storage token", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await page.getByLabel(/work email/i).fill(seed.staff.email);
    await page.getByLabel(/^password$/i).fill(seed.password);

    const loginResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/platform/auth/login") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const res = await loginResponse;
    expect(res.ok()).toBeTruthy();

    // Playwright/Vite proxy often omit Set-Cookie from response.headers(); prove
    // the browser cookie jar received the HttpOnly Lax session cookie instead.
    await expect(page.getByText(/unified inbox/i).first()).toBeVisible({ timeout: 25_000 });
    const cookies = await page.context().cookies(siteOrigin);
    const session = cookies.find((c) => c.name === AUTH_COOKIE);
    expect(session, `cookies=${cookies.map((c) => c.name).join(",")}`).toBeTruthy();
    expect(session!.httpOnly).toBe(true);
    // WebKit's cookie jar often normalizes local SameSite=Lax as "None"; attribute
    // contract is asserted on the direct API Set-Cookie response below.
    expect(["lax", "none"]).toContain(String(session!.sameSite).toLowerCase());
    expect(session!.value.length).toBeGreaterThan(16);

    // Direct API login still exposes Set-Cookie attributes for contract proof.
    await page.context().clearCookies();
    const apiLogin = await loginApi(page.request, seed.staff.email, seed.password);
    expect(apiLogin.res.status()).toBe(200);
    const setCookie = apiLogin.res.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain(`${AUTH_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");

    await expectNoBrowserSessionStorage(page);
  });

  test("invalid credentials return the same non-enumerating response for known and unknown email", async ({
    page,
  }) => {
    const known = await loginApi(page.request, seed.staff.email, "wrong-password");
    const unknown = await loginApi(page.request, `missing.${Date.now()}@example.com`, "wrong-password");

    expect(known.res.status()).toBe(401);
    expect(unknown.res.status()).toBe(401);
    expect(known.body).toEqual(unknown.body);
    expect(String(known.body.error)).toMatch(/invalid email or password/i);
  });

  test("rate-limited login is enforced by the platform token bucket", async ({ page }) => {
    exhaustLoginIpRateLimits();
    const attempt = await loginApi(page.request, seed.rateLimitedEmail, "wrong-password");
    expect(attempt.res.status(), `seeded keys: ${seed.rateLimitKeys.join(", ")}`).toBe(429);
    expect(attempt.res.headers()["retry-after"]).toBeTruthy();
    expect(String(attempt.body.error)).toMatch(/too many attempts/i);
    clearLoginIpRateLimits();
  });

  test("invitation accept sets password, signs in, and rejects invalid expired and reused tokens", async ({
    page,
  }) => {
    const invalid = await authedPost(page, "/api/platform/auth/invite/accept", {
      token: seed.invalidInviteToken,
      password: seed.password,
    });
    expect(invalid.status).toBe(400);

    const expired = await authedPost(page, "/api/platform/auth/invite/accept", {
      token: seed.expiredInvite.token,
      password: seed.password,
    });
    expect(expired.status).toBe(400);

    await page.goto(`/admin?mode=invite&token=${encodeURIComponent(seed.invite.token)}`);
    await expect(page.getByRole("heading", { name: /accept your invitation/i })).toBeVisible();
    await page.getByLabel(/full name/i).fill("Invited E2E Staff");
    await page.getByLabel(/^new password$/i).fill(seed.password);
    await page.getByLabel(/^confirm password$/i).fill(seed.password);
    await page.getByRole("button", { name: /activate account/i }).click();
    await expect(page.getByRole("heading", { name: /you're all set/i })).toBeVisible({ timeout: 20_000 });

    const acceptedLogin = await loginApi(page.request, seed.invite.email, seed.password);
    expect(acceptedLogin.res.status()).toBe(200);
    expect(acceptedLogin.body.authenticated).toBe(true);

    const reused = await authedPost(page, "/api/platform/auth/invite/accept", {
      token: seed.invite.token,
      password: seed.password,
    });
    expect(reused.status).toBe(400);
  });

  test("forgot and reset password succeed without enumeration, then reject expired invalid and reused reset tokens", async ({
    page,
  }) => {
    const knownForgot = await authedPost(page, "/api/platform/auth/forgot-password", {
      email: seed.resetStaff.email,
    });
    const unknownForgot = await authedPost(page, "/api/platform/auth/forgot-password", {
      email: `nobody.${Date.now()}@example.com`,
    });
    expect(knownForgot.status).toBe(200);
    expect(unknownForgot.status).toBe(200);
    expect(knownForgot.body).toEqual(unknownForgot.body);

    const expired = await authedPost(page, "/api/platform/auth/reset-password", {
      challengeId: seed.expiredReset.challengeId,
      code: seed.expiredReset.code,
      newPassword: seed.resetPassword,
    });
    expect(expired.status).toBe(400);

    const invalid = await authedPost(page, "/api/platform/auth/reset-password", {
      challengeId: seed.invalidResetToken.split(".")[0],
      code: "000000",
      newPassword: seed.resetPassword,
    });
    expect(invalid.status).toBe(400);

    await page.goto(`/admin?mode=reset&token=${encodeURIComponent(seed.reset.token)}`);
    await expect(page.getByRole("heading", { name: /choose a new password/i })).toBeVisible();
    await page.getByLabel(/^new password$/i).fill(seed.resetPassword);
    await page.getByLabel(/^confirm password$/i).fill(seed.resetPassword);
    await page.getByRole("button", { name: /update password/i }).click();
    await expect(page.getByRole("heading", { name: /password updated/i })).toBeVisible({ timeout: 20_000 });

    const oldLogin = await loginApi(page.request, seed.resetStaff.email, seed.password);
    expect(oldLogin.res.status()).toBe(401);
    const newLogin = await loginApi(page.request, seed.resetStaff.email, seed.resetPassword);
    expect(newLogin.res.status()).toBe(200);

    const reused = await authedPost(page, "/api/platform/auth/reset-password", {
      challengeId: seed.reset.challengeId,
      code: seed.reset.code,
      newPassword: seed.password,
    });
    expect(reused.status).toBe(400);
  });

  test("MFA enroll confirm login recovery code and reused recovery rejection use first-party endpoints", async ({
    page,
  }) => {
    const initial = await loginApi(page.request, seed.mfaStaff.email, seed.password);
    expect(initial.res.status()).toBe(200);
    expect(initial.body.accountId).toBe(seed.mfaStaff.accountId);

    const enrollment = await authedPost(page, "/api/platform/auth/mfa/enroll");
    expect(enrollment.status).toBe(200);
    const secret = secretFromOtpauth(String(enrollment.body.otpauthUri));
    const confirm = await authedPost(page, "/api/platform/auth/mfa/confirm", {
      code: totpCode(secret),
    });
    expect(confirm.status).toBe(200);

    const recovery = await authedPost(page, "/api/platform/auth/mfa/recovery-codes");
    expect(recovery.status).toBe(200);
    const codes = recovery.body.codes as string[];
    expect(codes.length).toBeGreaterThan(0);
    await authedPost(page, "/api/platform/auth/logout");

    const mfaLogin = await loginApi(page.request, seed.mfaStaff.email, seed.password);
    expect(mfaLogin.res.status()).toBe(200);
    expect(mfaLogin.body.mfaRequired).toBe(true);
    const totp = await authedPost(page, "/api/platform/auth/mfa/challenge", {
      accountId: seed.mfaStaff.accountId,
      method: "totp",
      code: totpCode(secret),
    });
    expect(totp.status).toBe(200);
    expect(totp.body.authenticated).toBe(true);
    await authedPost(page, "/api/platform/auth/logout");

    const recoveryLogin = await loginApi(page.request, seed.mfaStaff.email, seed.password);
    expect(recoveryLogin.body.mfaRequired).toBe(true);
    const recoveryCode = codes[0]!;
    const recovered = await authedPost(page, "/api/platform/auth/mfa/challenge", {
      accountId: seed.mfaStaff.accountId,
      method: "recovery",
      code: recoveryCode,
    });
    expect(recovered.status).toBe(200);
    await authedPost(page, "/api/platform/auth/logout");

    await loginApi(page.request, seed.mfaStaff.email, seed.password);
    const reused = await authedPost(page, "/api/platform/auth/mfa/challenge", {
      accountId: seed.mfaStaff.accountId,
      method: "recovery",
      code: recoveryCode,
    });
    expect(reused.status).toBe(401);
  });

  test("logout and logout-all revoke this-device and all-device sessions", async ({ playwright }) => {
    const ctx1 = await playwright.request.newContext({ extraHTTPHeaders: headers() });
    const ctx2 = await playwright.request.newContext({ extraHTTPHeaders: headers() });
    try {
      await loginApi(ctx1, seed.owner.email, seed.password);
      let session = await ctx1.get(`${apiRoot}/api/platform/auth/session`);
      expect(session.status()).toBe(200);
      const logout = await ctx1.post(`${apiRoot}/api/platform/auth/logout`, { data: {} });
      expect(logout.status()).toBe(204);
      session = await ctx1.get(`${apiRoot}/api/platform/auth/session`);
      expect(session.status()).toBe(401);

      await loginApi(ctx1, seed.owner.email, seed.password);
      await loginApi(ctx2, seed.owner.email, seed.password);
      const logoutAll = await ctx1.post(`${apiRoot}/api/platform/auth/logout-all`, { data: {} });
      expect(logoutAll.status()).toBe(204);
      expect((await ctx1.get(`${apiRoot}/api/platform/auth/session`)).status()).toBe(401);
      expect((await ctx2.get(`${apiRoot}/api/platform/auth/session`)).status()).toBe(401);
    } finally {
      await ctx1.dispose();
      await ctx2.dispose();
    }
  });

  test("pending activation and suspended staff are denied platform access", async ({ page }) => {
    for (const denied of [seed.pendingActivation, seed.suspended]) {
      const login = await loginApi(page.request, denied.email, seed.password);
      expect(login.res.status()).toBe(200);
      expect(login.body.authenticated).toBe(true);
      expect(login.body.staff).toBeNull();
      const me = await page.request.get(`${apiRoot}/api/platform/me`, { headers: headers() });
      expect(me.status()).toBe(401);
      await page.context().clearCookies();
    }

    await page.goto("/admin");
    await page.getByLabel(/work email/i).fill(seed.suspended.email);
    await page.getByLabel(/^password$/i).fill(seed.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("alert")).toContainText(/not active/i);
  });

  test("English and Arabic login strings render with expected direction", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await page.getByRole("button", { name: /العربية|language/i }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await expect(page.locator("[dir='rtl']")).toBeVisible();
    await expect(page.getByLabel(/البريد الإلكتروني للعمل/)).toBeVisible();
  });

  test("login form supports keyboard focus through email password and submit", async ({ page }) => {
    await page.goto("/admin");
    const email = page.getByLabel(/work email/i);
    const password = page.getByLabel(/^password$/i);
    const submit = page.getByRole("button", { name: /^sign in$/i });

    await email.focus();
    await expect(email).toBeFocused();
    await password.focus();
    await expect(password).toBeFocused();
    await submit.focus();
    await expect(submit).toBeFocused();

    await email.fill(seed.staff.email);
    await password.fill(seed.password);
    await password.press("Enter");
    await expect(page.getByText(/unified inbox/i).first()).toBeVisible({ timeout: 25_000 });
  });

  test("cross-role denial rejects low-privilege mutation", async ({ page }) => {
    const login = await loginApi(page.request, seed.lowPrivilege.email, seed.password);
    expect(login.res.status()).toBe(200);

    const denied = await authedPost(page, "/api/platform/contact/config/changes", {
      entityType: "sla_policy",
      entityId: crypto.randomUUID(),
      afterValue: {},
    });
    expect(denied.status).toBe(403);
  });

  test("administrative session revocation and logout leave subsequent session checks unauthorized", async ({
    page,
  }) => {
    const login = await loginApi(page.request, seed.owner.email, seed.password);
    expect(login.res.status()).toBe(200);
    const listed = await page.request.get(`${apiRoot}/api/platform/auth/sessions`, {
      headers: headers(),
    });
    expect(listed.status()).toBe(200);
    const body = await readJson(listed);
    const sessions = body.sessions as Array<{ id: string }>;
    expect(sessions.length).toBeGreaterThan(0);
    const revoke = await page.request.delete(
      `${apiRoot}/api/platform/auth/sessions/${encodeURIComponent(sessions[0]!.id)}`,
      { headers: headers() },
    );
    expect([200, 204]).toContain(revoke.status());
    const after = await page.request.get(`${apiRoot}/api/platform/auth/session`, {
      headers: headers(),
    });
    expect(after.status()).toBe(401);
  });

  test("CRM admin session restores after reload without browser storage tokens", async ({ page }) => {
    await page.goto("/admin");
    await page.getByLabel(/work email/i).fill(seed.staff.email);
    await page.getByLabel(/^password$/i).fill(seed.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByText(/unified inbox/i).first()).toBeVisible({ timeout: 25_000 });
    await page.reload();
    await expect(page.getByText(/unified inbox/i).first()).toBeVisible({ timeout: 25_000 });
    await expectNoBrowserSessionStorage(page);
  });

  test("login validation summary is announced and focuses the first invalid field", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeFocused();
  });

  test("handler-role staff can establish a first-party session for handler surfaces", async ({
    page,
  }) => {
    // Handler UI may be served separately; prove the shared auth contract that
    // HandlerLogin uses (cookie session + /platform/me authorization).
    await page.goto("/admin");
    const login = await loginApi(page.request, seed.staff.email, seed.password);
    expect(login.res.status()).toBe(200);
    expect(login.body.authenticated).toBe(true);
    const session = await page.request.get(`${apiRoot}/api/platform/auth/session`, {
      headers: headers(),
    });
    expect(session.status()).toBe(200);
    const me = await page.request.get(`${apiRoot}/api/platform/me`, { headers: headers() });
    expect(me.status()).toBe(200);
    await expectNoBrowserSessionStorage(page);
  });
});
