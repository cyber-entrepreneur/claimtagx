import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_EVENT_SCHEMA_VERSION,
  batchIdempotencyKey,
  classifyAnalyticsPii,
  redactForExport,
} from "./analyticsIntegration.ts";

describe("analytics integration boundary", () => {
  it("versions the event schema and classifies PII", () => {
    assert.equal(ANALYTICS_EVENT_SCHEMA_VERSION, 1);
    assert.equal(classifyAnalyticsPii({ source: "web" }), "none");
    assert.equal(classifyAnalyticsPii({ contactId: "x" }), "indirect");
    assert.equal(classifyAnalyticsPii({ email: "a@b.c" }), "direct");
    assert.equal(redactForExport({ email: "a@b.c", source: "web" }, "direct").email, "[redacted]");
    assert.equal(redactForExport({ email: "a@b.c", source: "web" }, "direct").source, "web");
  });

  it("builds idempotent batch keys from watermark cursor", () => {
    const a = batchIdempotencyKey("memory", "abc", 1);
    const b = batchIdempotencyKey("memory", "abc", 1);
    assert.equal(a, b);
    assert.notEqual(batchIdempotencyKey("memory", "abc", 1), batchIdempotencyKey("memory", "def", 1));
  });
});
