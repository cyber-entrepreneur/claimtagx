import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const contact = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "claimtagx", "src", "pages", "Contact.tsx"),
  "utf8",
);

describe("public contact form accessibility (source)", () => {
  it("uses native required, autocomplete, and an error summary", () => {
    assert.match(contact, /required/);
    assert.match(contact, /autoComplete/);
    assert.match(contact, /role="alert"|aria-live/);
    assert.match(contact, /aria-invalid/);
    assert.match(contact, /useReducedMotion/);
  });

  it("announces confirmation assertively", () => {
    assert.match(contact, /data-testid="contact-confirmation"/);
    assert.match(contact, /aria-live="assertive"/);
    assert.match(contact, /role="alert"/);
    assert.doesNotMatch(contact, /role="status"[\s\S]*aria-live="assertive"|aria-live="assertive"[\s\S]*role="status"/);
    assert.match(contact, /headingRef\.current\?\.focus\(\)/);
  });

  it("does not imply a fallback country was detected as IP", () => {
    assert.equal(/We detected your country/i.test(contact) && /fallback/i.test(contact), false);
  });
});
