import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundedPageSize, decodeTimeIdCursor, encodeTimeIdCursor } from "./keysetCursor.ts";

describe("keyset cursor", () => {
  it("round-trips createdAt and id", () => {
    const createdAt = new Date("2026-09-04T12:00:00.000Z");
    const encoded = encodeTimeIdCursor({ createdAt, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const decoded = decodeTimeIdCursor(encoded);
    assert.ok(decoded);
    assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
    assert.equal(decoded.id, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("clamps page size", () => {
    assert.equal(boundedPageSize(0, 50, 100), 1);
    assert.equal(boundedPageSize(999, 50, 100), 100);
    assert.equal(boundedPageSize("nope", 50, 100), 50);
  });
});
