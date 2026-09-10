import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BUSINESS_CALENDAR,
  __clearSlaOffsetCache,
  addBusinessMinutes,
  businessMinutesBetween,
  calendarFromPolicy,
  ianaOffsetMinutes,
  type BusinessCalendar,
} from "./slaCalendar.ts";
import {
  addBusinessMinutesReference,
  businessMinutesBetweenReference,
} from "./slaCalendar.reference.ts";

const ZONES = [
  "UTC",
  "America/New_York",
  "Europe/London",
  "Asia/Beirut",
  "Asia/Kolkata",
  "Australia/Adelaide",
  "Pacific/Auckland",
] as const;

function weekdayCal(zone: string, holidays: string[] = []): BusinessCalendar {
  return {
    timeZone: zone,
    offsetMinutes: zone === "UTC" ? 0 : undefined,
    hours: { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 },
    holidays,
  };
}

function assertSameAdd(start: Date, minutes: number, cal: BusinessCalendar, label: string) {
  __clearSlaOffsetCache();
  const fast = addBusinessMinutes(start, minutes, cal);
  const slow = addBusinessMinutesReference(start, minutes, cal);
  assert.equal(
    fast.toISOString(),
    slow.toISOString(),
    `${label}: fast=${fast.toISOString()} slow=${slow.toISOString()} start=${start.toISOString()} minutes=${minutes} zone=${cal.timeZone}`,
  );
}

describe("sla business calendar", () => {
  it("skips weekends when adding business minutes", () => {
    const friday = new Date("2026-08-28T16:00:00.000Z");
    const due = addBusinessMinutes(friday, 120, DEFAULT_BUSINESS_CALENDAR);
    assert.equal(due.toISOString(), "2026-08-31T10:00:00.000Z");
  });

  it("skips holidays", () => {
    const cal: BusinessCalendar = {
      ...DEFAULT_BUSINESS_CALENDAR,
      holidays: ["2026-08-31"],
    };
    const friday = new Date("2026-08-28T16:00:00.000Z");
    const due = addBusinessMinutes(friday, 120, cal);
    assert.equal(due.toISOString(), "2026-09-01T10:00:00.000Z");
  });

  it("counts only open minutes between two instants", () => {
    const start = new Date("2026-08-28T09:00:00.000Z");
    const end = new Date("2026-08-28T11:00:00.000Z");
    assert.equal(businessMinutesBetween(start, end, DEFAULT_BUSINESS_CALENDAR), 120);
  });

  it("uses a larger IANA offset in January than in July for America/New_York", () => {
    __clearSlaOffsetCache();
    const winter = ianaOffsetMinutes(new Date("2026-01-15T12:00:00.000Z"), "America/New_York");
    const summer = ianaOffsetMinutes(new Date("2026-07-15T12:00:00.000Z"), "America/New_York");
    assert.equal(winter, -300);
    assert.equal(summer, -240);
  });

  it("builds operator calendars from policy holidays and IANA zone", () => {
    const cal = calendarFromPolicy({ timeZone: "UTC", holidays: ["2026-12-25"] });
    assert.deepEqual(cal.holidays, ["2026-12-25"]);
    assert.equal(cal.timeZone, "UTC");
    assert.equal(cal.offsetMinutes, 0);
  });

  it("adds a full business week of resolution minutes in under 50ms", () => {
    const t0 = performance.now();
    const due = addBusinessMinutes(new Date("2026-09-03T12:00:00.000Z"), 10_080, DEFAULT_BUSINESS_CALENDAR);
    const ms = performance.now() - t0;
    assert.ok(ms < 50, `expected <50ms, got ${ms.toFixed(1)}ms`);
    assert.equal(due.toISOString(), "2026-10-02T12:00:00.000Z");
  });

  it("matches minute-step semantics across a weekend boundary for IANA calendars", () => {
    const cal = weekdayCal("America/New_York");
    const friday = new Date("2026-08-28T20:00:00.000Z");
    assertSameAdd(friday, 120, cal, "ny-weekend");
  });
});

describe("sla calendar DST and offset correctness", () => {
  it("America/New_York spring-forward: deadline crossing DST matches reference", () => {
    // 2026-03-08 spring forward 02:00 -> 03:00 local. Start Friday before.
    const cal = weekdayCal("America/New_York");
    const start = new Date("2026-03-06T18:00:00.000Z"); // Fri 13:00 EST
    assertSameAdd(start, 480, cal, "ny-spring");
    assertSameAdd(start, 720, cal, "ny-spring-long");
  });

  it("America/New_York fall-back: deadline crossing DST matches reference", () => {
    // 2026-11-01 fall back 02:00 -> 01:00 local.
    const cal = weekdayCal("America/New_York");
    const start = new Date("2026-10-30T17:00:00.000Z"); // Fri 13:00 EDT
    assertSameAdd(start, 480, cal, "ny-fall");
    assertSameAdd(start, 720, cal, "ny-fall-long");
  });

  it("Europe/London spring-forward and fall-back match reference", () => {
    const cal = weekdayCal("Europe/London");
    assertSameAdd(new Date("2026-03-27T10:00:00.000Z"), 180, cal, "london-spring");
    assertSameAdd(new Date("2026-10-23T10:00:00.000Z"), 180, cal, "london-fall");
  });

  it("Asia/Beirut DST transitions match reference", () => {
    const cal = weekdayCal("Asia/Beirut");
    assertSameAdd(new Date("2026-03-27T08:00:00.000Z"), 180, cal, "beirut-spring");
    assertSameAdd(new Date("2026-10-23T08:00:00.000Z"), 180, cal, "beirut-fall");
  });

  it("Pacific/Auckland DST transitions match reference", () => {
    const cal = weekdayCal("Pacific/Auckland");
    assertSameAdd(new Date("2026-04-02T22:00:00.000Z"), 180, cal, "akl-fall");
    assertSameAdd(new Date("2026-09-25T22:00:00.000Z"), 180, cal, "akl-spring");
  });

  it("Australia/Adelaide half-hour / DST offsets match reference", () => {
    const cal = weekdayCal("Australia/Adelaide");
    assertSameAdd(new Date("2026-04-02T02:00:00.000Z"), 240, cal, "adl-fall");
    assertSameAdd(new Date("2026-10-01T02:00:00.000Z"), 240, cal, "adl-spring");
    __clearSlaOffsetCache();
    const winter = ianaOffsetMinutes(new Date("2026-06-15T12:00:00.000Z"), "Australia/Adelaide");
    const summer = ianaOffsetMinutes(new Date("2026-01-15T12:00:00.000Z"), "Australia/Adelaide");
    assert.ok(Number.isInteger(winter * 2), `expected half-hour granularity, got ${winter}`);
    assert.notEqual(winter, summer);
  });

  it("Asia/Kolkata fixed +05:30 matches reference", () => {
    const cal = weekdayCal("Asia/Kolkata");
    assertSameAdd(new Date("2026-06-15T04:00:00.000Z"), 120, cal, "kolkata");
    __clearSlaOffsetCache();
    assert.equal(ianaOffsetMinutes(new Date("2026-06-15T12:00:00.000Z"), "Asia/Kolkata"), 330);
  });

  it("fixed positive, negative, half-hour, and 45-minute offsets match reference", () => {
    for (const offset of [180, -300, 330, 345, -210]) {
      const cal: BusinessCalendar = {
        timeZone: "Fixed",
        offsetMinutes: offset,
        hours: { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 },
        holidays: [],
      };
      assertSameAdd(new Date("2026-06-10T08:00:00.000Z"), 200, cal, `fixed-${offset}`);
    }
  });

  it("consecutive holidays and holiday-weekend adjacency match reference", () => {
    const cal = weekdayCal("UTC", ["2026-12-24", "2026-12-25", "2026-12-28"]);
    // Thu 24 / Fri 25 holidays, weekend 26-27, Mon 28 holiday → Tue 29
    assertSameAdd(new Date("2026-12-23T15:00:00.000Z"), 120, cal, "holiday-cluster");
  });

  it("handles zero duration, empty/closed calendars, and leap-year boundary", () => {
    const start = new Date("2024-02-29T12:00:00.000Z");
    assert.equal(addBusinessMinutes(start, 0, DEFAULT_BUSINESS_CALENDAR).toISOString(), start.toISOString());
    const closed: BusinessCalendar = {
      ...DEFAULT_BUSINESS_CALENDAR,
      hours: { days: [1, 2, 3, 4, 5], startMinute: 10 * 60, endMinute: 10 * 60 },
    };
    assertSameAdd(start, 30, closed, "closed-hours-fallback");
    assertSameAdd(new Date("2023-12-29T12:00:00.000Z"), 480, DEFAULT_BUSINESS_CALENDAR, "year-boundary");
    assertSameAdd(new Date("2024-02-28T12:00:00.000Z"), 480, DEFAULT_BUSINESS_CALENDAR, "leap-year");
  });

  it("hour-level offset cache remains correct across a DST transition day", () => {
    __clearSlaOffsetCache();
    // Probe both sides of US spring-forward (2026-03-08 local).
    const before = ianaOffsetMinutes(new Date("2026-03-08T06:30:00.000Z"), "America/New_York"); // 01:30 EST
    const after = ianaOffsetMinutes(new Date("2026-03-08T07:30:00.000Z"), "America/New_York"); // 03:30 EDT
    assert.equal(before, -300);
    assert.equal(after, -240);
    // Re-read should hit hour cache without cross-contaminating.
    assert.equal(ianaOffsetMinutes(new Date("2026-03-08T06:45:00.000Z"), "America/New_York"), -300);
    assert.equal(ianaOffsetMinutes(new Date("2026-03-08T07:45:00.000Z"), "America/New_York"), -240);
  });
});

describe("sla calendar randomized equivalence vs reference", { timeout: 120_000 }, () => {
  it("matches reference over randomized calendars, starts, zones, and durations", { timeout: 120_000 }, () => {
    // Deterministic PRNG for stable CI.
    let seed = 0xc0ffee;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

    const failures: string[] = [];
    for (let i = 0; i < 12; i++) {
      const zone = pick(ZONES);
      const startMs =
        Date.UTC(2025, 0, 1) + Math.floor(rand() * (Date.UTC(2027, 0, 1) - Date.UTC(2025, 0, 1)));
      // Align to whole minutes.
      const start = new Date(Math.floor(startMs / 60_000) * 60_000);
      const minutes = 1 + Math.floor(rand() * 45);
      const holidayCount = Math.floor(rand() * 3);
      const holidays: string[] = [];
      for (let h = 0; h < holidayCount; h++) {
        const d = new Date(start.getTime() + Math.floor(rand() * 40) * 86_400_000);
        holidays.push(
          `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
        );
      }
      const startMinute = Math.floor(rand() * 8) * 60; // 0..7h
      const endMinute = startMinute + 60 + Math.floor(rand() * 8) * 60; // at least 1h open
      const cal: BusinessCalendar = {
        timeZone: zone,
        offsetMinutes: zone === "UTC" ? 0 : undefined,
        hours: {
          days: [1, 2, 3, 4, 5],
          startMinute,
          endMinute: Math.min(endMinute, 22 * 60),
        },
        holidays,
      };
      try {
        assertSameAdd(start, minutes, cal, `rand-${i}`);
        const end = addBusinessMinutes(start, minutes, cal);
        __clearSlaOffsetCache();
        const betweenFast = businessMinutesBetween(start, end, cal);
        const betweenSlow = businessMinutesBetweenReference(start, end, cal);
        assert.equal(betweenFast, betweenSlow, `between rand-${i}`);
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    assert.equal(failures.length, 0, failures.slice(0, 5).join("\n"));
  });
});
