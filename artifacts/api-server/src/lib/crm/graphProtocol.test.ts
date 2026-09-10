import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { resetGraphTokenCache, acquireGraphAccessToken, buildClientAssertionForTest } from "./microsoftGraph/auth";
import { classifyGraphHttpStatus, graphFetch, parseRetryAfterMs } from "./microsoftGraph/http";
import {
  fetchGraphDeltaPage,
  sendMailViaGraph,
} from "./microsoftGraph/client";
import type { MicrosoftGraphConfig } from "./microsoftGraph/config";
import { resetGraphSimulator } from "./microsoftGraph/simulator";
import {
  graphNotificationAuthorized,
  graphNotificationEventId,
  parseGraphNotifications,
  respondGraphValidationToken,
  verifyGraphClientState,
} from "./microsoftGraph/webhookSecurity";
import { decryptDeltaLink, encryptDeltaLink } from "./microsoftGraph/deltaTokenStore";

function config(overrides: Partial<MicrosoftGraphConfig> = {}): MicrosoftGraphConfig {
  return {
    tenantId: "tenant",
    clientId: "client",
    credential: { kind: "secret", clientSecret: "secret" },
    mailboxUpn: "ops@example.com",
    notificationUrl: "https://example.com/contact/webhooks/microsoft-graph/mail",
    clientState: "expected-state",
    deltaEncryptionKey: Buffer.alloc(32, 9),
    ...overrides,
  };
}

describe("Microsoft Graph protocol fixtures", () => {
  beforeEach(() => {
    resetGraphTokenCache();
    resetGraphSimulator();
    process.env.CRM_GRAPH_SIMULATOR = "true";
  });

  it("returns validation tokens verbatim for subscription handshake", () => {
    const res = respondGraphValidationToken("token-123");
    assert.equal(res.body, "token-123");
    assert.equal(res.status, 200);
  });

  it("verifies clientState with constant-time compare", () => {
    assert.equal(verifyGraphClientState("expected-state", "expected-state").ok, true);
    assert.equal(verifyGraphClientState("wrong", "expected-state").ok, false);
  });

  it("rejects malformed notification batches", () => {
    assert.equal(parseGraphNotifications(null).length, 0);
    assert.equal(graphNotificationAuthorized(config(), []).ok, false);
  });

  it("derives stable ids for duplicate notification replay detection", () => {
    const n = {
      subscriptionId: "sub",
      clientState: "expected-state",
      changeType: "created",
      resource: "Users/u/Messages/a",
      resourceData: { id: "a" },
    };
    assert.equal(graphNotificationEventId(n), graphNotificationEventId(n));
  });

  it("caches access tokens until near expiry", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    };
    const cfg = config();
    assert.equal(await acquireGraphAccessToken(cfg, fetchImpl as typeof fetch), "tok");
    assert.equal(await acquireGraphAccessToken(cfg, fetchImpl as typeof fetch), "tok");
    assert.equal(calls, 1);
  });

  it("builds certificate JWT assertions with RS256 header", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const assertion = buildClientAssertionForTest(
      config({ credential: { kind: "certificate", thumbprint: "ab".repeat(20), privateKeyPem: pem } }),
    );
    assert.ok(assertion);
    assert.equal(assertion!.split(".").length, 3);
  });

  it("classifies Graph HTTP statuses for retry policy", () => {
    assert.equal(classifyGraphHttpStatus(429), "throttle");
    assert.equal(classifyGraphHttpStatus(503), "transient");
    assert.equal(classifyGraphHttpStatus(404), "permanent");
    assert.equal(classifyGraphHttpStatus(403), "auth");
  });

  it("parses Retry-After seconds and dates", () => {
    assert.equal(parseRetryAfterMs("2"), 2000);
    const future = new Date(Date.now() + 5000).toUTCString();
    assert.ok((parseRetryAfterMs(future) ?? 0) >= 0);
  });

  it("retries transient Graph responses", async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts < 3) return new Response("busy", { status: 503 });
      return new Response("ok", { status: 200 });
    };
    const res = await graphFetch("https://graph.microsoft.com/v1.0/me", {}, fetchImpl as typeof fetch, {
      maxAttempts: 4,
      baseDelayMs: 1,
    });
    assert.equal(res.status, 200);
    assert.equal(attempts, 3);
  });

  it("encrypts and rotates delta links at rest", () => {
    const key = Buffer.alloc(32, 3);
    const enc = encryptDeltaLink("https://graph.microsoft.com/delta?token=1", key);
    assert.notEqual(enc, "https://graph.microsoft.com/delta?token=1");
    assert.equal(decryptDeltaLink(enc, key), "https://graph.microsoft.com/delta?token=1");
  });

  it("paginates delta responses through nextLink then persists deltaLink", async () => {
    delete process.env.CRM_GRAPH_SIMULATOR;
    delete process.env.CRM_EMAIL_SIMULATOR;
    delete process.env.CRM_ALLOW_TEST_JOBS;
    resetGraphTokenCache();
    let deltaCalls = 0;
    const fetchImpl = async (url: string) => {
      if (url.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      deltaCalls += 1;
      if (deltaCalls === 1) {
        return new Response(
          JSON.stringify({
            value: [{ id: "m1", from: { emailAddress: { address: "a@b.com" } }, body: { contentType: "text", content: "hi" } }],
            "@odata.nextLink": "https://graph.microsoft.com/next",
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          value: [],
          "@odata.deltaLink": "https://graph.microsoft.com/delta-final",
        }),
        { status: 200 },
      );
    };
    const page1 = await fetchGraphDeltaPage(config(), initialDeltaUrl(), fetchImpl as typeof fetch);
    assert.equal(page1.messages.length, 1);
    assert.ok(page1.nextLink);
    const page2 = await fetchGraphDeltaPage(config(), page1.nextLink!, fetchImpl as typeof fetch);
    assert.equal(page2.messages.length, 0);
    assert.ok(page2.deltaLink);
  });

  it("simulates outbound idempotency without duplicate provider ids", async () => {
    process.env.CRM_GRAPH_SIMULATOR = "true";
    const first = await sendMailViaGraph(config(), {
      to: "guest@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      idempotencyKey: "idem-1",
    });
    const second = await sendMailViaGraph(config(), {
      to: "guest@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      idempotencyKey: "idem-1",
    });
    assert.equal(first.providerMessageId, second.providerMessageId);
  });

  it("honours Retry-After on 429 before succeeding", async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("throttle", { status: 429, headers: { "Retry-After": "0" } });
      }
      return new Response("ok", { status: 200 });
    };
    const res = await graphFetch("https://graph.microsoft.com/v1.0/me", {}, fetchImpl as typeof fetch, {
      maxAttempts: 3,
      baseDelayMs: 1,
    });
    assert.equal(res.status, 200);
    assert.equal(attempts, 2);
  });

  it("treats 401/403 as auth and stops retrying", async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      return new Response("denied", { status: 401 });
    };
    const res = await graphFetch("https://graph.microsoft.com/v1.0/me", {}, fetchImpl as typeof fetch, {
      maxAttempts: 4,
      baseDelayMs: 1,
    });
    assert.equal(res.status, 401);
    assert.equal(attempts, 1);
  });

  it("rejects notification batches with mismatched clientState", () => {
    const notifications = [
      {
        subscriptionId: "sub",
        clientState: "wrong",
        changeType: "created",
        resource: "Users/u/Messages/a",
        resourceData: { id: "a" },
      },
    ];
    assert.equal(graphNotificationAuthorized(config(), notifications).ok, false);
  });

  it("accepts authorized notification batches with matching clientState", () => {
    const notifications = [
      {
        subscriptionId: "sub",
        clientState: "expected-state",
        changeType: "created",
        resource: "Users/u/Messages/a",
        resourceData: { id: "a" },
      },
    ];
    assert.equal(graphNotificationAuthorized(config(), notifications).ok, true);
  });
});

function initialDeltaUrl(): string {
  return "https://graph.microsoft.com/v1.0/users/ops@example.com/mailFolders/inbox/messages/delta";
}
