import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePhone, isAcceptablePhone } from "./phone.ts";

describe("phone normalization", () => {
  it("normalizes US numbers to E.164", () => {
    const phone = normalizePhone("+1 (415) 555-2671", "US");
    assert.equal(phone.phoneE164, "+14155552671");
    assert.equal(isAcceptablePhone(phone), true);
  });

  it("covers representative E.164 countries and pasted international numbers", () => {
    assert.equal(normalizePhone("03 123 456", "LB").phoneE164, "+9613123456");
    assert.equal(normalizePhone("+44 20 7946 0958", "GB").phoneE164, "+442079460958");
    assert.equal(normalizePhone("07911 123456", "GB").phoneCountryCallingCode, "44");
    assert.equal(normalizePhone("+971 50 123 4567", "AE").phoneValidationStatus, "valid");
    assert.equal(normalizePhone("06 12 34 56 78", "FR").phoneE164?.startsWith("+33"), true);
    assert.equal(isAcceptablePhone(normalizePhone("+96170123456", "US")), true);
  });

  it("rejects extensions rather than persisting them on the inquiry phone", () => {
    const phone = normalizePhone("+14155552671;ext=99", "US");
    assert.equal(phone.phoneValidationStatus, "invalid");
    assert.equal(phone.phoneE164, null);
    assert.equal(isAcceptablePhone(phone), false);
  });

  it("rejects incomplete and ambiguous national fragments", () => {
    assert.equal(isAcceptablePhone(normalizePhone("123", "US")), false);
    assert.equal(isAcceptablePhone(normalizePhone("555-1212", "US")), false);
  });

  it("normalizes Arabic-Indic digits for RTL entry", () => {
    assert.equal(normalizePhone("٠٣ ١٢٣ ٤٥٦", "LB").phoneE164, "+9613123456");
  });

  it("treats empty input as empty, not valid", () => {
    assert.equal(normalizePhone("   ", "US").phoneValidationStatus, "empty");
    assert.equal(isAcceptablePhone(normalizePhone("", "US")), false);
  });
});
