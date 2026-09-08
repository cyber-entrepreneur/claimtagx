import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inboundWebhookAuthorized } from "./webhookSecurity.ts";

describe("inbound webhook authorization (local fixture)", () => {
  it("rejects unsigned webhooks in production", () => {
    const result = inboundWebhookAuthorized({
      nodeEnv: "production",
      secret: undefined,
      provided: undefined,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it("rejects a mismatched secret", () => {
    const result = inboundWebhookAuthorized({
      nodeEnv: "production",
      secret: "expected-secret-value",
      provided: "other-secret-value!!",
    });
    assert.equal(result.ok, false);
  });

  it("accepts a matching secret", () => {
    const result = inboundWebhookAuthorized({
      nodeEnv: "production",
      secret: "shared-secret-token",
      provided: "shared-secret-token",
    });
    assert.equal(result.ok, true);
  });
});
