import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escalationForClock } from "./slaEscalation.ts";

describe("SLA escalation policy", () => {
  it("emits once when a clock first breaches", () => {
    const action = escalationForClock({
      previousStatus: "AT_RISK",
      nextStatus: "BREACHED",
      measure: "first_response",
    });
    assert.equal(action?.reason, "sla_first_response_breached");
  });

  it("does not re-escalate an already breached clock", () => {
    assert.equal(
      escalationForClock({ previousStatus: "BREACHED", nextStatus: "BREACHED", measure: "first_response" }),
      null,
    );
  });
});
