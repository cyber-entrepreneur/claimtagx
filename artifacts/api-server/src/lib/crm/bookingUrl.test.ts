import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookingUrlForAudit, parseGovernedBookingUrl } from "./bookingUrl.ts";

describe("governed booking URLs", () => {
  it("accepts https Calendly and rejects other schemes/hosts", () => {
    const ok = parseGovernedBookingUrl("https://calendly.com/claimtagx/demo");
    assert.ok(ok);
    assert.equal(bookingUrlForAudit(ok!), "https://calendly.com/claimtagx/demo");
    assert.equal(parseGovernedBookingUrl("javascript:alert(1)"), null);
    assert.equal(parseGovernedBookingUrl("http://calendly.com/x"), null);
    assert.equal(parseGovernedBookingUrl("https://evil.example/phish"), null);
    assert.equal(parseGovernedBookingUrl("https://calendly.com.evil.example/x"), null);
  });

  it("allows extra hosts only when explicitly configured", () => {
    assert.ok(
      parseGovernedBookingUrl("https://book.example.com/a", {
        CRM_BOOKING_ALLOWED_HOSTS: "book.example.com",
      }),
    );
    assert.equal(
      parseGovernedBookingUrl("https://book.example.com/a", {
        NODE_ENV: "production",
        CRM_BOOKING_ALLOWED_HOSTS: "book.example.com",
      }),
      null,
    );
  });
});
