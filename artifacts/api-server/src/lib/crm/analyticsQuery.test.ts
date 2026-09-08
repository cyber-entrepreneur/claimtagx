import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyticsCsv, parseAnalyticsWindow } from "./analyticsQuery.ts";

describe("analytics query window", () => {
  it("defaults to UTC with open bounds", () => {
    const w = parseAnalyticsWindow({});
    assert.equal(w.timeZone, "UTC");
    assert.equal(w.from, null);
    assert.equal(w.to, null);
  });

  it("rejects inverted ranges and invalid zones", () => {
    assert.throws(() => parseAnalyticsWindow({ from: "2026-02-01", to: "2026-01-01" }), /from must/);
    assert.throws(() => parseAnalyticsWindow({ timeZone: "Not/AZone" }), /IANA/);
  });

  it("emits csv with a header", () => {
    const csv = analyticsCsv([{ metric: "qualified", value: 3 }]);
    assert.match(csv, /metric,value/);
    assert.match(csv, /qualified/);
  });
});
