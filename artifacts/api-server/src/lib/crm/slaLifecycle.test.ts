import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateClock } from "./slaCalendar.ts";

describe("SLA clock evaluation", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("is on track when due is more than an hour away", () => {
    assert.equal(evaluateClock(new Date("2026-09-01T14:00:00.000Z"), now), "ON_TRACK");
  });

  it("is at risk inside the threshold", () => {
    assert.equal(evaluateClock(new Date("2026-09-01T12:30:00.000Z"), now), "AT_RISK");
  });

  it("is breached when due is in the past", () => {
    assert.equal(evaluateClock(new Date("2026-09-01T11:59:00.000Z"), now), "BREACHED");
  });
});

describe("SLA pause remaining", () => {
  it("stores leftover milliseconds at pause", async () => {
    const { remainingMsAtPause } = await import("./slaCalendar.ts");
    const remaining = remainingMsAtPause(
      new Date("2026-09-01T12:10:00.000Z"),
      new Date("2026-09-01T12:00:00.000Z"),
    );
    assert.equal(remaining, 10 * 60_000);
  });
});
