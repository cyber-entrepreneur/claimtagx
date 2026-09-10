import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultPasswordPolicy,
  describePasswordPolicy,
  evaluatePassword,
  isPasswordAcceptable,
} from "./password-policy.js";

describe("password policy", () => {
  it("default policy enforces only a minimum length of 8", () => {
    assert.equal(isPasswordAcceptable("short7!", defaultPasswordPolicy), false);
    assert.equal(isPasswordAcceptable("correct-horse", defaultPasswordPolicy), true);
    // No composition rules by default.
    assert.equal(isPasswordAcceptable("aaaaaaaa", defaultPasswordPolicy), true);
  });

  it("reports each violated composition rule when enabled", () => {
    const strict = {
      minLength: 12,
      requireUppercase: true,
      requireDigit: true,
      requireSymbol: true,
    };
    const result = evaluatePassword("lowercaseonly", strict);
    assert.equal(result.ok, false);
    assert.deepEqual([...result.violations].sort(), [
      "MISSING_DIGIT",
      "MISSING_SYMBOL",
      "MISSING_UPPERCASE",
    ]);

    assert.equal(isPasswordAcceptable("Str0ng-Passw0rd!", strict), true);
  });

  it("flags TOO_LONG beyond the configured maximum", () => {
    const result = evaluatePassword("x".repeat(20), { minLength: 8, maxLength: 16 });
    assert.deepEqual(result.violations, ["TOO_LONG"]);
  });

  it("describePasswordPolicy summarises the active requirements", () => {
    const text = describePasswordPolicy({ minLength: 10, requireDigit: true });
    assert.match(text, /at least 10 characters/);
    assert.match(text, /a digit/);
  });
});
