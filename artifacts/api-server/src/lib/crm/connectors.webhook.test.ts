import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { handleConnectorWebhook, CONNECTOR_WEBHOOK_MAX_BYTES } from "./connectors/http.ts";
import { whatsappAdapter } from "./connectors/whatsapp.ts";
import { xAdapter } from "./connectors/x.ts";
import { messengerAdapter } from "./connectors/metaMessaging.ts";
import { microsoft365Adapter } from "./connectors/microsoft365.ts";
import { verifyXTwitterWebhookSignature } from "./connectors/metaSignature.ts";

function mockRes() {
  const out: {
    statusCode: number;
    body: unknown;
    status: (n: number) => typeof out;
    json: (b: unknown) => typeof out;
    type: () => typeof out;
    send: (b: unknown) => typeof out;
  } = {
    statusCode: 0,
    body: null,
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    type() {
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
  };
  return out;
}

function asReq(partial: Record<string, unknown>): Request {
  return partial as unknown as Request;
}

describe("connector webhook security", () => {
  it("rejects WhatsApp POST with missing, malformed, and wrong signatures", async () => {
    process.env.WHATSAPP_APP_SECRET = "meta-secret";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify";
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const buf = Buffer.from(raw);
    const missing = mockRes();
    await handleConnectorWebhook(
      asReq({
        method: "POST",
        headers: { "content-type": "application/json" },
        query: {},
        body: JSON.parse(raw),
        rawBody: raw,
        rawBodyBytes: buf,
      }),
      missing as unknown as Response,
      whatsappAdapter,
    );
    assert.equal(missing.statusCode, 401);
    assert.equal((missing.body as { error?: string }).error, "missing_signature");

    const malformed = mockRes();
    await handleConnectorWebhook(
      asReq({
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "not-a-sig" },
        query: {},
        body: JSON.parse(raw),
        rawBody: raw,
        rawBodyBytes: buf,
      }),
      malformed as unknown as Response,
      whatsappAdapter,
    );
    assert.equal(malformed.statusCode, 401);

    const wrong = mockRes();
    await handleConnectorWebhook(
      asReq({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${createHmac("sha256", "other").update(buf).digest("hex")}`,
        },
        query: {},
        body: JSON.parse(raw),
        rawBody: raw,
        rawBodyBytes: buf,
      }),
      wrong as unknown as Response,
      whatsappAdapter,
    );
    assert.equal(wrong.statusCode, 401);

    const valid = mockRes();
    await handleConnectorWebhook(
      asReq({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${createHmac("sha256", "meta-secret").update(buf).digest("hex")}`,
        },
        query: {},
        body: JSON.parse(raw),
        rawBody: raw,
        rawBodyBytes: buf,
      }),
      valid as unknown as Response,
      whatsappAdapter,
    );
    assert.equal(valid.statusCode, 202);
  });

  it("rejects unsupported content type and oversized webhook bodies", async () => {
    process.env.WHATSAPP_APP_SECRET = "meta-secret";
    const raw = "{}";
    const typeRes = mockRes();
    await handleConnectorWebhook(
      asReq({
        method: "POST",
        headers: { "content-type": "text/plain" },
        query: {},
        body: {},
        rawBody: raw,
        rawBodyBytes: Buffer.from(raw),
      }),
      typeRes as unknown as Response,
      whatsappAdapter,
    );
    assert.equal(typeRes.statusCode, 415);

    const huge = Buffer.alloc(CONNECTOR_WEBHOOK_MAX_BYTES + 1, 97);
    const sizeRes = mockRes();
    await handleConnectorWebhook(
      asReq({
        method: "POST",
        headers: { "content-type": "application/json" },
        query: {},
        body: {},
        rawBody: huge.toString("utf8"),
        rawBodyBytes: huge,
      }),
      sizeRes as unknown as Response,
      messengerAdapter,
    );
    assert.equal(sizeRes.statusCode, 413);
  });

  it("requires official X-Twitter-Webhooks-Signature on POST", async () => {
    process.env.X_CONSUMER_SECRET = "x-secret";
    const raw = JSON.stringify({ for_user_id: "acct", direct_message_events: [] });
    const buf = Buffer.from(raw);
    const missing = mockRes();
    await handleConnectorWebhook(
      asReq({
        method: "POST",
        headers: { "content-type": "application/json" },
        query: {},
        body: JSON.parse(raw),
        rawBody: raw,
        rawBodyBytes: buf,
      }),
      missing as unknown as Response,
      xAdapter,
    );
    assert.equal(missing.statusCode, 401);

    const header = `sha256=${createHmac("sha256", "x-secret").update(buf).digest("base64")}`;
    assert.equal(verifyXTwitterWebhookSignature({ rawBody: buf, header, consumerSecret: "x-secret" }), true);
    const valid = mockRes();
    await handleConnectorWebhook(
      asReq({
        method: "POST",
        headers: { "content-type": "application/json", "x-twitter-webhooks-signature": header },
        query: {},
        body: JSON.parse(raw),
        rawBody: raw,
        rawBodyBytes: buf,
      }),
      valid as unknown as Response,
      xAdapter,
    );
    assert.equal(valid.statusCode, 202);
  });

  it("keeps Graph client-state verification", () => {
    const rejected = microsoft365Adapter.verifyWebhook({
      nodeEnv: "test",
      rawBody: "{}",
      headers: { "content-type": "application/json" },
      query: {},
      body: { value: [{ subscriptionId: "s", clientState: "wrong", changeType: "created", resource: "me" }] },
    });
    assert.equal(rejected.kind, "rejected");
    const challenge = microsoft365Adapter.verifyWebhook({
      nodeEnv: "test",
      rawBody: "",
      headers: {},
      query: { validationToken: "abc" },
      body: {},
    });
    assert.equal(challenge.kind, "challenge");
  });
});
