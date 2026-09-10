import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { inboundWebhookAuthorized } from "./webhookSecurity.ts";
import { sanitizeHtml } from "./htmlSanitize.ts";

describe("failure-mode contracts (local)", () => {
  it("unsigned production webhooks fail closed", () => {
    const result = inboundWebhookAuthorized({
      nodeEnv: "production",
      secret: undefined,
      provided: undefined,
    });
    assert.equal(result.ok, false);
  });

  it("sanitizes script payloads in inbound HTML", () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
    assert.equal(/script/i.test(out), false);
    assert.equal(/javascript:/i.test(out), false);
  });

  it("worker claim SQL remains SKIP LOCKED", () => {
    const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "queue.ts"), "utf8");
    assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  });
});
