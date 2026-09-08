import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  createGraphMailSubscription,
  extractHeader,
  renewGraphSubscription,
} from "./microsoftGraph/client";
import { graphMessageToInboundPayload } from "./microsoftGraph/messageParser";
import { resetGraphSimulator, simulatedGraphSend } from "./microsoftGraph/simulator";
import type { MicrosoftGraphConfig } from "./microsoftGraph/config";
import { buildClientAssertionForTest } from "./microsoftGraph/auth";

function testConfig(): MicrosoftGraphConfig {
  return {
    tenantId: "tenant",
    clientId: "client",
    credential: { kind: "secret", clientSecret: "secret" },
    mailboxUpn: "ops@example.com",
    notificationUrl: "https://example.com/contact/webhooks/microsoft-graph/mail",
    clientState: "state",
    deltaEncryptionKey: Buffer.alloc(32, 1),
  };
}

describe("Microsoft Graph inbound and simulator", () => {
  beforeEach(() => {
    process.env.CRM_GRAPH_SIMULATOR = "true";
    resetGraphSimulator();
  });

  it("maps Graph messages to inbound payloads with threading headers", () => {
    const payload = graphMessageToInboundPayload({
      id: "msg-1",
      subject: "Re: Inquiry",
      body: { contentType: "text", content: "Thanks for reaching out." },
      from: { emailAddress: { address: "customer@example.com" } },
      internetMessageId: "<abc@mail.example>",
      internetMessageHeaders: [
        { name: "In-Reply-To", value: "<orig@mail.example>" },
        { name: "References", value: "<orig@mail.example>" },
      ],
    });
    assert.ok(payload);
    assert.equal(payload?.from, "customer@example.com");
    assert.equal(payload?.inReplyTo, "<orig@mail.example>");
    assert.equal(payload?.references, "<orig@mail.example>");
    assert.equal(extractHeader({ id: "x", internetMessageHeaders: [{ name: "Message-ID", value: "<m@x>" }] }, "Message-ID"), "<m@x>");
  });

  it("deduplicates simulated outbound sends by idempotency key", async () => {
    const first = await simulatedGraphSend({ idempotencyKey: "key-1", to: "a@b.com", subject: "Hello" });
    const second = await simulatedGraphSend({ idempotencyKey: "key-1", to: "a@b.com", subject: "Hello" });
    assert.equal(first.providerMessageId, second.providerMessageId);
  });

  it("creates and renews simulated subscriptions", async () => {
    const config = testConfig();
    const created = await createGraphMailSubscription(config);
    assert.match(created.id, /^sim_sub_/);
    const renewed = await renewGraphSubscription(config, created.id);
    assert.equal(renewed.id, created.id);
    assert.ok(new Date(renewed.expirationDateTime).getTime() > Date.now());
  });
});

describe("Microsoft Graph certificate auth", () => {
  it("builds a JWT client assertion for certificate credentials", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const thumbprint = "a".repeat(40);
    const config: MicrosoftGraphConfig = {
      ...testConfig(),
      credential: { kind: "certificate", thumbprint, privateKeyPem: pem },
    };
    const assertion = buildClientAssertionForTest(config);
    assert.ok(assertion);
    assert.equal(assertion!.split(".").length, 3);
  });
});
