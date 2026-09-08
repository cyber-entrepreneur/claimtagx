import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertBotAdapterProduction,
  botAdapterKind,
  botMetrics,
  publicBotProtectionConfig,
  resetBotMetrics,
  setTurnstileFetchForTests,
  verifyBotProof,
} from "./botAdapter.ts";

const prodBase = {
  NODE_ENV: "production",
  CRM_BOT_ADAPTER: "turnstile",
  CRM_TURNSTILE_SECRET_KEY: "prod-secret-not-dummy",
  CRM_TURNSTILE_SITE_KEY: "prod-site-key-not-dummy",
  CRM_TURNSTILE_EXPECTED_HOSTNAMES: "www.claimtagx.com",
  CRM_TURNSTILE_EXPECTED_ACTION: "contact_submit",
  CRM_BOT_REPLAY_STORE: "memory",
} as NodeJS.ProcessEnv;

describe("bot adapter", () => {
  it("classifies adapters including turnstile", () => {
    assert.equal(botAdapterKind({}), "unset");
    assert.equal(botAdapterKind({ CRM_BOT_ADAPTER: "honeypot_only" }), "honeypot_only");
    assert.equal(botAdapterKind({ CRM_BOT_ADAPTER: "simulator" }), "simulator");
    assert.equal(botAdapterKind({ CRM_BOT_ADAPTER: "turnstile" }), "turnstile");
  });

  it("forbids honeypot-only, simulator, dummy keys, and missing secrets in production", () => {
    assert.throws(() => assertBotAdapterProduction({ NODE_ENV: "production" }), /turnstile/);
    assert.throws(
      () => assertBotAdapterProduction({ NODE_ENV: "production", CRM_BOT_ADAPTER: "honeypot_only" }),
      /honeypot_only is forbidden/,
    );
    assert.throws(
      () => assertBotAdapterProduction({ NODE_ENV: "production", CRM_BOT_ADAPTER: "simulator" }),
      /simulator/,
    );
    assert.throws(
      () =>
        assertBotAdapterProduction({
          NODE_ENV: "production",
          CRM_BOT_ADAPTER: "turnstile",
          CRM_TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          CRM_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          CRM_TURNSTILE_EXPECTED_HOSTNAMES: "localhost",
        }),
      /dummy/,
    );
    assert.doesNotThrow(() => assertBotAdapterProduction(prodBase));
  });

  it("does not expose the secret in public bootstrap config", () => {
    const pub = publicBotProtectionConfig(prodBase);
    assert.equal(pub.siteKey, "prod-site-key-not-dummy");
    assert.equal(JSON.stringify(pub).includes("prod-secret"), false);
    assert.equal(pub.proofRequired, true);
    assert.equal(pub.fallback, "email");
  });

  it("rejects honeypot fills before provider verification", async () => {
    await assert.rejects(
      () => verifyBotProof({ honeypot: "http://spam" }, { NODE_ENV: "development" }),
      /Unable to submit/,
    );
  });

  it("verifies a Turnstile-compatible payload, hostname, action, timeout, and replay", async () => {
    resetBotMetrics();
    setTurnstileFetchForTests(async () => {
      return new Response(
        JSON.stringify({ success: true, hostname: "www.claimtagx.com", action: "contact_submit" }),
        { status: 200 },
      );
    });
    try {
      await verifyBotProof({ botProof: "token-one", hostname: "www.claimtagx.com" }, prodBase);
      await assert.rejects(
        () => verifyBotProof({ botProof: "token-one", hostname: "www.claimtagx.com" }, prodBase),
        /Unable to submit/,
      );
      assert.equal(botMetrics().accepted, 1);
      assert.equal(botMetrics().rejected, 1);
    } finally {
      setTurnstileFetchForTests(null);
    }
  });

  it("rejects missing provider hostname/action and never trusts a client hostname", async () => {
    resetBotMetrics();
    setTurnstileFetchForTests(async () => {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    try {
      await assert.rejects(
        () => verifyBotProof({ botProof: "tok", hostname: "www.claimtagx.com" }, prodBase),
        (err: Error & { status?: number }) => err.status === 400,
      );
    } finally {
      setTurnstileFetchForTests(null);
    }
  });

  it("rejects a successful payload whose hostname does not match server expectations", async () => {
    resetBotMetrics();
    setTurnstileFetchForTests(async () => {
      return new Response(
        JSON.stringify({ success: true, hostname: "evil.example", action: "contact_submit" }),
        { status: 200 },
      );
    });
    try {
      await assert.rejects(
        () => verifyBotProof({ botProof: "tok-host" }, prodBase),
        (err: Error & { status?: number }) => err.status === 400,
      );
    } finally {
      setTurnstileFetchForTests(null);
    }
  });
  it("fails closed when the provider is unavailable", async () => {
    resetBotMetrics();
    setTurnstileFetchForTests(async () => {
      throw new Error("network");
    });
    try {
      await assert.rejects(
        () => verifyBotProof({ botProof: "token-two" }, prodBase),
        (err: Error & { status?: number }) => err.status === 503,
      );
      assert.equal(botMetrics().unavailable, 1);
    } finally {
      setTurnstileFetchForTests(null);
    }
  });

  it("fails closed on provider HTTP 5xx and 4xx", async () => {
    resetBotMetrics();
    setTurnstileFetchForTests(async () => new Response("nope", { status: 502 }));
    try {
      await assert.rejects(
        () => verifyBotProof({ botProof: "tok-5xx" }, prodBase),
        (err: Error & { status?: number }) => err.status === 503,
      );
    } finally {
      setTurnstileFetchForTests(null);
    }
    setTurnstileFetchForTests(async () => new Response("bad", { status: 400 }));
    try {
      await assert.rejects(
        () => verifyBotProof({ botProof: "tok-4xx" }, prodBase),
        (err: Error & { status?: number }) => err.status === 400,
      );
    } finally {
      setTurnstileFetchForTests(null);
    }
  });

  it("rejects a successful payload whose action is missing even when the client supplies one", async () => {
    resetBotMetrics();
    setTurnstileFetchForTests(async () => {
      return new Response(JSON.stringify({ success: true, hostname: "www.claimtagx.com" }), { status: 200 });
    });
    try {
      await assert.rejects(
        () => verifyBotProof({ botProof: "tok-act", action: "contact_submit" }, prodBase),
        (err: Error & { status?: number }) => err.status === 400,
      );
    } finally {
      setTurnstileFetchForTests(null);
    }
  });
});
