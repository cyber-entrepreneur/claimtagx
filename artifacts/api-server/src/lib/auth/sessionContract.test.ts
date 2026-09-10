import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { isCredentialedOriginAllowed } from "../crm/corsOrigin.ts";
import {
  FakeClock,
  InMemoryOpaqueTokenRepository,
  NodeSecureRandom,
  OpaqueTokenService,
  hashToken,
} from "../../../../../lib/first-party-auth/src/index.ts";

const PROD_ORIGINS = "https://claimtagx.com,https://api.claimtagx.com";

const MUTATED_ENV_KEYS = ["NODE_ENV", "CORS_ALLOWED_ORIGINS"];
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const composeSource = readFileSync(join(apiRoot, "lib", "auth", "composeAuthPlatform.ts"), "utf8");
const appSource = readFileSync(join(apiRoot, "app.ts"), "utf8");

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const previous = new Map(MUTATED_ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("first-party session contract", () => {
  it("uses the shared session cookie name and hardened cookie options", () => {
    assert.match(composeSource, /export const AUTH_SESSION_COOKIE = "ctx_auth_session"/);
    assert.match(composeSource, /httpOnly:\s*true/);
    assert.match(composeSource, /secure:\s*prod/);
    assert.match(composeSource, /sameSite:\s*prod \? "none" : "lax"/);
    assert.match(composeSource, /path:\s*"\/"/);
    assert.match(composeSource, /SESSION_COOKIE_MAX_AGE_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  });

  it("stores opaque access and refresh tokens only by SHA-256 hash", async () => {
    const repo = new InMemoryOpaqueTokenRepository();
    const clock = new FakeClock(1_000);
    const service = new OpaqueTokenService(repo, new NodeSecureRandom(), clock);
    const context = {
      accountId: "account-1",
      sessionId: "session-1",
      scopes: ["platform"],
    } as never;

    const access = await service.issueAccess(context, 10_000 as never);
    const refresh = await service.issueRefresh("session-1" as never, 10_000 as never);

    assert.notEqual(hashToken(access), access);
    assert.notEqual(hashToken(refresh), refresh);
    assert.ok(await repo.findByAccessHash(hashToken(access)));
    assert.ok(await repo.findByRefreshHash(hashToken(refresh)));
    assert.equal(await repo.findByAccessHash(access), undefined);
    assert.equal(await repo.findByRefreshHash(refresh), undefined);
  });

  it("reflects only configured production origins for credentialed CORS", async () => {
    await withEnv({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: PROD_ORIGINS }, async () => {
      assert.equal(isCredentialedOriginAllowed("https://claimtagx.com"), true);
      assert.equal(isCredentialedOriginAllowed("https://api.claimtagx.com"), true);
      assert.equal(isCredentialedOriginAllowed("https://evil.example"), false);
      assert.equal(isCredentialedOriginAllowed("https://claimtagx.com.evil.example"), false);
    });
  });

  it("app-level cookie CSRF rejects missing or hostile origins before platform mutations", () => {
    assert.match(appSource, /CSRF_EXEMPT_AUTH_PATHS/);
    assert.match(appSource, /AUTH_SESSION_COOKIE/);
    assert.match(appSource, /isCredentialedOriginAllowed\(origin\)/);
    assert.match(appSource, /res\.status\(403\)\.json\(\{ error: "CSRF origin rejected" \}\)/);
    assert.equal(isCredentialedOriginAllowed(undefined, { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: PROD_ORIGINS }), false);
    assert.equal(isCredentialedOriginAllowed("https://evil.example", { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: PROD_ORIGINS }), false);
  });
});
