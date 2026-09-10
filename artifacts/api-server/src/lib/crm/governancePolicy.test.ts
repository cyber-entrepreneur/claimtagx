import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCorrectionRequest,
  redactContactForRole,
  staffCanViewPii,
} from "./governancePolicy.ts";

describe("governance policy helpers", () => {
  it("masks PII when the viewer cannot see it", () => {
    const redacted = redactContactForRole(
      { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phoneE164: "+15551212" },
      false,
    );
    assert.equal(redacted.email.includes("***"), true);
    assert.equal(redacted.firstName, "A.");
  });

  it("denies PII to analyst role defaults", () => {
    assert.equal(staffCanViewPii({ role: "analyst" }), false);
    assert.equal(staffCanViewPii({ role: "sales" }), true);
  });

  it("validates correction requests", () => {
    assert.throws(() => buildCorrectionRequest({ contactId: "x", fields: [], reason: "please fix" }));
    const ok = buildCorrectionRequest({
      contactId: "c1",
      fields: ["email"],
      reason: "Wrong email on file",
    });
    assert.equal(ok.fields[0], "email");
  });
});
