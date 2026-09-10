import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLegacyAccessKeyLoginAllowed, isCrmHttpTestAuthAllowed, assertProductionSecurity } from "./authFlags.ts";

describe("legacy access-key login flags", () => {
  it("is never allowed in production even when the override flag is set", () => {
    assert.equal(
      isLegacyAccessKeyLoginAllowed({
        NODE_ENV: "production",
        PLATFORM_ALLOW_ACCESS_KEY_LOGIN: "true",
      }),
      false,
    );
  });

  it("requires an explicit non-prod dual flag", () => {
    assert.equal(
      isLegacyAccessKeyLoginAllowed({
        NODE_ENV: "development",
        PLATFORM_ALLOW_ACCESS_KEY_LOGIN: "true",
      }),
      true,
    );
    assert.equal(
      isLegacyAccessKeyLoginAllowed({
        NODE_ENV: "development",
      }),
      false,
    );
  });

  it("honors a force-disable even in development", () => {
    assert.equal(
      isLegacyAccessKeyLoginAllowed({
        NODE_ENV: "development",
        PLATFORM_ALLOW_ACCESS_KEY_LOGIN: "true",
        CRM_FORCE_DISABLE_ACCESS_KEY: "true",
      }),
      false,
    );
  });

  it("ignores CRM_HTTP_TEST_AUTH outside non-production", () => {
    assert.equal(isCrmHttpTestAuthAllowed({ NODE_ENV: "production", CRM_HTTP_TEST_AUTH: "true" }), false);
    assert.equal(isCrmHttpTestAuthAllowed({ NODE_ENV: "development", CRM_HTTP_TEST_AUTH: "true" }), true);
  });

  it("fails production startup without session and signing secrets", () => {
    assert.throws(() => assertProductionSecurity({ NODE_ENV: "production" }), /PLATFORM_STAFF_SESSION_SECRET/);
  });

  it("fails production startup when extra Graph hosts are configured", () => {
    assert.throws(
      () =>
        assertProductionSecurity({
          NODE_ENV: "production",
          PLATFORM_STAFF_SESSION_SECRET: "x".repeat(32),
          CRM_ATTACHMENT_SIGNING_SECRET: "prod-secret",
          MS_GRAPH_ALLOWED_HOSTS: "evil.example",
        }),
      /MS_GRAPH_ALLOWED_HOSTS/,
    );
  });

  it("fails production startup unless Turnstile is fully configured", () => {
    assert.throws(
      () =>
        assertProductionSecurity({
          NODE_ENV: "production",
          PLATFORM_STAFF_SESSION_SECRET: "x".repeat(32),
          CRM_ATTACHMENT_SIGNING_SECRET: "prod-secret",
          CRM_BOT_ADAPTER: "honeypot_only",
        }),
      /honeypot_only is forbidden/,
    );
    assert.doesNotThrow(() =>
      assertProductionSecurity({
        NODE_ENV: "production",
        PLATFORM_STAFF_SESSION_SECRET: "x".repeat(32),
        CRM_ATTACHMENT_SIGNING_SECRET: "prod-secret",
        CRM_BOT_ADAPTER: "turnstile",
        CRM_TURNSTILE_SECRET_KEY: "prod-secret-not-dummy",
        CRM_TURNSTILE_SITE_KEY: "prod-site-key-not-dummy",
        CRM_TURNSTILE_EXPECTED_HOSTNAMES: "www.claimtagx.com",
      }),
    );
  });
});
