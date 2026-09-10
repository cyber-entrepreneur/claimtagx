import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planContactMerge } from "./contactMerge.ts";

describe("contact merge plan", () => {
  it("rejects merging a contact into itself", () => {
    assert.throws(() => planContactMerge("a", "a"), /distinct/);
  });

  it("rewrites the loser email instead of deleting history", () => {
    const plan = planContactMerge("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    assert.equal(plan.winnerId.startsWith("aaaa"), true);
    assert.match(plan.loserEmail, /@merged\.invalid$/);
  });
});
