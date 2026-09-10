import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  corsOriginDelegate,
  isCredentialedOriginAllowed,
  parseBrowserOrigin,
} from "./corsOrigin.ts";

const prod = {
  NODE_ENV: "production",
  CORS_ALLOWED_ORIGINS: "https://app.claimtagx.com,https://www.claimtagx.com",
};

const dev = { NODE_ENV: "development" };

function corsAllows(origin: string | undefined, env: typeof prod | typeof dev): boolean {
  let allowed = false;
  let err: Error | null = null;
  corsOriginDelegate(origin, (e, allow) => {
    err = e;
    allowed = Boolean(allow) && !e;
  }, env);
  return allowed && err == null;
}

describe("credentialed origin policy", () => {
  it("production accepts only explicitly configured origins", () => {
    assert.equal(isCredentialedOriginAllowed("https://app.claimtagx.com", prod), true);
    assert.equal(isCredentialedOriginAllowed("https://www.claimtagx.com", prod), true);
    assert.equal(isCredentialedOriginAllowed("https://other.claimtagx.com", prod), false);
  });

  it("production does not enable arbitrary loopback-port origins", () => {
    assert.equal(isCredentialedOriginAllowed("http://127.0.0.1:5173", prod), false);
    assert.equal(isCredentialedOriginAllowed("http://127.0.0.1:5174", prod), false);
    assert.equal(isCredentialedOriginAllowed("http://localhost:5173", prod), false);
    assert.equal(isCredentialedOriginAllowed("https://127.0.0.1:5173", prod), false);
  });

  it("non-production accepts intended loopback hosts and dynamic ports", () => {
    assert.equal(isCredentialedOriginAllowed("http://127.0.0.1:5173", dev), true);
    assert.equal(isCredentialedOriginAllowed("http://127.0.0.1:5174", dev), true);
    assert.equal(isCredentialedOriginAllowed("http://localhost:18081", dev), true);
    assert.equal(isCredentialedOriginAllowed("http://127.0.0.1:8080", dev), true);
  });

  it("rejects hostile, suffixed, userinfo, alternate-scheme, and malformed origins", () => {
    const attacks = [
      "https://evil.example",
      "http://127.0.0.1.evil.com:5173",
      "http://127.0.0.1:5173.evil.com",
      "http://localhost.evil.com:5173",
      "http://127.0.0.1:5174@evil.com",
      "http://evil@127.0.0.1:5174",
      "http://user:pass@127.0.0.1:5174",
      "https://127.0.0.1:5174.attacker",
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "http://127.0.0.1:5174/path",
      "http://127.0.0.1:5174?q=1",
      "http://127.0.0.1:5174#x",
      "http://127.0.0.1:5174 ",
      " http://127.0.0.1:5174",
      "http://127.0.0.1",
      "127.0.0.1:5174",
      "http://[::1]:5174",
      "ws://127.0.0.1:5174",
      "http://127.0.0.1:99999",
      "http://127.0.0.1:0",
      "null",
      "",
    ];
    for (const origin of attacks) {
      assert.equal(isCredentialedOriginAllowed(origin, dev), false, origin);
      assert.equal(isCredentialedOriginAllowed(origin, prod), false, origin);
      assert.equal(parseBrowserOrigin(origin) == null || !isCredentialedOriginAllowed(origin, dev), true, origin);
    }
  });

  it("CORS allows missing origin (non-browser) but CSRF helper does not", () => {
    assert.equal(corsAllows(undefined, prod), true);
    assert.equal(isCredentialedOriginAllowed(undefined, prod), false);
    assert.equal(isCredentialedOriginAllowed("", prod), false);
  });

  it("credentialed checks use exact origin serialization", () => {
    assert.equal(parseBrowserOrigin("http://127.0.0.1:5174")?.origin, "http://127.0.0.1:5174");
    assert.equal(parseBrowserOrigin("http://127.0.0.1:5174/"), null);
  });
});
