import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { closeIsolatedHttpServer } from "../crm/isolatedCrmDatabase.ts";

const VALID_PROD_ENV: Record<string, string> = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://unit:unit@127.0.0.1:55432/claimtagx_crm_unit",
  MS_GRAPH_TENANT_ID: "tenant-id",
  MS_GRAPH_CLIENT_ID: "client-id",
  MS_GRAPH_CLIENT_SECRET: "client-secret",
  AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

const MUTATED_ENV_KEYS = [
  ...Object.keys(VALID_PROD_ENV),
  "CRM_HTTP_TEST_AUTH",
  "AUTH_ALLOW_DEV_JWT",
  "AUTH_USE_IN_MEMORY",
  "MS_GRAPH_CLIENT_CERTIFICATE",
];

type ComposeAuthPlatformModule = typeof import("./composeAuthPlatform.ts");

async function importComposeAuthPlatform(): Promise<ComposeAuthPlatformModule> {
  return import("./composeAuthPlatform.ts");
}

async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: (authModule: ComposeAuthPlatformModule) => T | Promise<T>,
): Promise<T> {
  const previous = new Map(MUTATED_ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    // Clear every mutated key first so ambient shell flags (e.g. CRM_HTTP_TEST_AUTH
    // left from browser qualification) cannot leak into production composition proofs.
    for (const key of MUTATED_ENV_KEYS) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const authModule = await importComposeAuthPlatform();
    authModule.__resetAuthServiceForTests();
    return await fn(authModule);
  } finally {
    const authModule = await importComposeAuthPlatform();
    authModule.__resetAuthServiceForTests();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function listenApp(): Promise<{ server: Server; base: string }> {
  const { default: app } = await import("../../app.ts");
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

describe("production auth composition", () => {
  it("refuses development auth bypass flags in production", async () => {
    for (const flag of ["CRM_HTTP_TEST_AUTH", "AUTH_ALLOW_DEV_JWT", "AUTH_USE_IN_MEMORY"]) {
      await withEnv({ ...VALID_PROD_ENV, [flag]: "true" }, ({ getAuthService }) => {
        assert.throws(
          () => getAuthService(),
          /Production auth composition refused: development auth bypass flags are set/,
          `${flag}=true should fail closed`,
        );
      });
      await withEnv({ ...VALID_PROD_ENV, [flag]: "1" }, ({ getAuthService }) => {
        assert.throws(
          () => getAuthService(),
          /Production auth composition refused: development auth bypass flags are set/,
          `${flag}=1 should fail closed`,
        );
      });
    }
  });

  it("refuses missing Microsoft Graph credentials in production", async () => {
    for (const missing of ["MS_GRAPH_TENANT_ID", "MS_GRAPH_CLIENT_ID", "MS_GRAPH_CLIENT_SECRET"]) {
      await withEnv({ ...VALID_PROD_ENV, [missing]: undefined, MS_GRAPH_CLIENT_CERTIFICATE: undefined }, ({ getAuthService }) => {
        assert.throws(
          () => getAuthService(),
          /Microsoft Graph mail credentials are required/,
          `${missing} should be required`,
        );
      });
    }
  });

  it("refuses missing MFA encryption key in production", async () => {
    await withEnv({ ...VALID_PROD_ENV, AUTH_MFA_ENCRYPTION_KEY: undefined }, ({ getAuthService }) => {
      assert.throws(
        () => getAuthService(),
        /AUTH_MFA_ENCRYPTION_KEY is required in production/,
      );
    });
  });

  it("wires the production service contract to durable first-party adapters", async () => {
    await withEnv(VALID_PROD_ENV, ({ getAuthService }) => {
      const service = getAuthService();
      assert.equal(service.platform.deliverer.constructor.name, "GraphCodeDeliverer");

      const source = readFileSync(fileURLToPath(new URL("./composeAuthPlatform.ts", import.meta.url)), "utf8");
      for (const required of [
        "new PostgresAccountRepository",
        "new PostgresCredentialRepository",
        "new PostgresSessionRepository",
        "new PostgresVerificationRepository",
        "new PostgresOpaqueTokenRepository",
        "new OpaqueTokenService",
        "new Argon2idPasswordHasher",
        "EncryptedTotpAuthenticator.fromEncodedKey",
        "new PostgresRateLimiter",
        "new GraphCodeDeliverer",
      ]) {
        assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      assert.doesNotMatch(source, /\bnew\s+(?:DevJwtTokenService|InMemoryRateLimiter|Rfc6238TotpAuthenticator)\b/);
    });
  });

  it("keeps test-login impossible in production even when the flag is set", async () => {
    await withEnv({ ...VALID_PROD_ENV, CRM_HTTP_TEST_AUTH: "true" }, async () => {
      const { server, base } = await listenApp();
      try {
        const res = await fetch(`${base}/api/platform/auth/test-login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ staffId: "00000000-0000-4000-8000-000000000000" }),
        });
        assert.ok(res.status === 404 || res.status === 410, `expected 404/410, got ${res.status}`);
      } finally {
        await closeIsolatedHttpServer(server);
      }
    });
  });
});
