import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNetworkUncertainSubmitError, mapContactSubmitError } from "./contactSubmitErrors.ts";

const t = (key: string) => key;

describe("contact submit error mapping", () => {
  it("maps timeout-after-commit style network errors to a non-duplicate message", () => {
    assert.equal(isNetworkUncertainSubmitError(new Error("Failed to fetch")), true);
    assert.equal(mapContactSubmitError(new Error("Failed to fetch"), t), "contact.errors.networkUncertain");
  });

  it("keeps HTTP 429 as rate-limit copy", () => {
    const err = Object.assign(new Error("slow down"), { status: 429 });
    assert.equal(mapContactSubmitError(err, t), "contact.errors.rateLimit");
  });
});
