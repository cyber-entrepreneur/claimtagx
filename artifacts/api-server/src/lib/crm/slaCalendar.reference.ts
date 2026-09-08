/**
 * Slow, correctness-first SLA calendar reference.
 * Used only by tests — never import from production request paths.
 *
 * Semantics: count a business minute for each UTC minute where the local
 * civil time falls inside an open business window (non-holiday, allowed weekday,
 * startMinute <= minuteOfDay < endMinute). Offset is recomputed every minute.
 */
import type { BusinessCalendar } from "./slaCalendar";

function offsetAt(utc: Date, cal: BusinessCalendar): number {
  if (typeof cal.offsetMinutes === "number") return cal.offsetMinutes;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: cal.timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(utc).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - utc.getTime()) / 60_000;
}

function localAt(utc: Date, cal: BusinessCalendar) {
  const offsetMinutes = offsetAt(utc, cal);
  const t = new Date(utc.getTime() + offsetMinutes * 60_000);
  const isoDate = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  return {
    day: t.getUTCDay(),
    minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(),
    isoDate,
  };
}

function isOpenRef(utc: Date, cal: BusinessCalendar): boolean {
  const openSpan = cal.hours.endMinute - cal.hours.startMinute;
  if (openSpan <= 0) return false;
  const p = localAt(utc, cal);
  if (cal.holidays.includes(p.isoDate)) return false;
  if (!cal.hours.days.includes(p.day)) return false;
  return p.minuteOfDay >= cal.hours.startMinute && p.minuteOfDay < cal.hours.endMinute;
}

/** Minute-step reference for addBusinessMinutes. */
export function addBusinessMinutesReference(
  start: Date,
  minutes: number,
  cal: BusinessCalendar,
): Date {
  if (minutes <= 0) return new Date(start);
  const openSpan = cal.hours.endMinute - cal.hours.startMinute;
  if (openSpan <= 0) {
    return new Date(start.getTime() + minutes * 60_000);
  }
  let cursor = new Date(start.getTime());
  let remaining = minutes;
  const guardLimit = minutes * 24 * 60 + 50_000;
  for (let guard = 0; guard < guardLimit && remaining > 0; guard += 1) {
    if (isOpenRef(cursor, cal)) {
      remaining -= 1;
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return cursor;
}

/** Minute-step reference for businessMinutesBetween. */
export function businessMinutesBetweenReference(
  start: Date,
  end: Date,
  cal: BusinessCalendar,
): number {
  if (end <= start) return 0;
  let cursor = new Date(start.getTime());
  let count = 0;
  const limit = end.getTime();
  const guardLimit = 400 * 24 * 60;
  for (let guard = 0; guard < guardLimit && cursor.getTime() < limit; guard += 1) {
    if (isOpenRef(cursor, cal)) count += 1;
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return count;
}
