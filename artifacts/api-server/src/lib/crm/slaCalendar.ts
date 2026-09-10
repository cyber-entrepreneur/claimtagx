/**
 * Business-calendar helpers for SLA due-date calculation.
 * Supports timezone offsets, weekly business hours, and holiday exclusions.
 *
 * Hot path: addBusinessMinutes / businessMinutesBetween must stay O(business days)
 * for fixed-offset calendars. IANA zones use segment jumps only when the UTC offset
 * is constant across the segment; otherwise they fall back to minute steps with an
 * hour-granularity offset cache (safe across DST transitions within a day).
 */

export interface BusinessHours {
  /** 0=Sunday … 6=Saturday */
  days: number[];
  startMinute: number; // minutes from midnight inclusive
  endMinute: number; // exclusive
}

export interface BusinessCalendar {
  timeZone: string; // IANA identifier. Used when offsetMinutes is omitted.
  /** Fixed offset from UTC. When set, DST is ignored (deterministic tests). */
  offsetMinutes?: number;
  hours: BusinessHours;
  /** YYYY-MM-DD holiday dates in the calendar's local civil date */
  holidays: string[];
}

/** Hour-granularity cache: DST transitions occur at hour boundaries in civil time. */
const offsetCache = new Map<string, number>();
const dtfCache = new Map<string, Intl.DateTimeFormat>();
const holidaySetCache = new WeakMap<BusinessCalendar, Set<string>>();

function holidaySet(cal: BusinessCalendar): Set<string> {
  let set = holidaySetCache.get(cal);
  if (!set) {
    set = new Set(cal.holidays);
    holidaySetCache.set(cal, set);
  }
  return set;
}

/** Minutes east of UTC for `timeZone` at `utc`. */
export function ianaOffsetMinutes(utc: Date, timeZone: string): number {
  const hourKey = `${timeZone}|${Math.floor(utc.getTime() / 3_600_000)}`;
  const cached = offsetCache.get(hourKey);
  if (cached !== undefined) return cached;

  const dtf =
    dtfCache.get(timeZone) ??
    (() => {
      const created = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      dtfCache.set(timeZone, created);
      return created;
    })();
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
  const offset = (asUtc - utc.getTime()) / 60_000;
  offsetCache.set(hourKey, offset);
  return offset;
}

function calendarOffset(cal: BusinessCalendar, utc: Date): number {
  if (typeof cal.offsetMinutes === "number") return cal.offsetMinutes;
  return ianaOffsetMinutes(utc, cal.timeZone);
}

export const DEFAULT_BUSINESS_CALENDAR: BusinessCalendar = {
  timeZone: "UTC",
  offsetMinutes: 0,
  hours: { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 },
  holidays: [],
};

function localParts(utc: Date, cal: BusinessCalendar) {
  const offsetMinutes = calendarOffset(cal, utc);
  const t = new Date(utc.getTime() + offsetMinutes * 60_000);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    d: t.getUTCDate(),
    day: t.getUTCDay(),
    minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(),
    isoDate: `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`,
    offsetMinutes,
  };
}

/**
 * Convert local civil y-m-d + minuteOfDay to UTC.
 * For IANA zones, refine the offset until stable (handles DST edges).
 */
function utcFromLocal(
  y: number,
  m: number,
  d: number,
  minuteOfDay: number,
  cal: BusinessCalendar,
  hintOffsetMinutes: number,
): Date {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  const localAsUtcMs = Date.UTC(y, m, d, hours, minutes, 0);
  if (typeof cal.offsetMinutes === "number") {
    return new Date(localAsUtcMs - cal.offsetMinutes * 60_000);
  }
  let guess = localAsUtcMs - hintOffsetMinutes * 60_000;
  for (let i = 0; i < 4; i++) {
    const offset = ianaOffsetMinutes(new Date(guess), cal.timeZone);
    const next = localAsUtcMs - offset * 60_000;
    if (next === guess) return new Date(guess);
    guess = next;
  }
  return new Date(guess);
}

function addLocalDays(
  y: number,
  m: number,
  d: number,
  days: number,
): { y: number; m: number; d: number; day: number } {
  const t = new Date(Date.UTC(y, m, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), day: t.getUTCDay() };
}

function isHoliday(cal: BusinessCalendar, isoDate: string): boolean {
  return holidaySet(cal).has(isoDate);
}

function isBusinessDay(cal: BusinessCalendar, day: number, isoDate: string): boolean {
  if (isHoliday(cal, isoDate)) return false;
  return cal.hours.days.includes(day);
}

function isOpen(cal: BusinessCalendar, utc: Date): boolean {
  const p = localParts(utc, cal);
  if (!isBusinessDay(cal, p.day, p.isoDate)) return false;
  return p.minuteOfDay >= cal.hours.startMinute && p.minuteOfDay < cal.hours.endMinute;
}

function advanceOpenMinutesMinuteStep(
  start: Date,
  minutes: number,
  cal: BusinessCalendar,
): { cursor: Date; remaining: number } {
  let cursor = new Date(start.getTime());
  let remaining = minutes;
  const guardLimit = minutes + 2;
  for (let guard = 0; guard < guardLimit && remaining > 0; guard += 1) {
    if (isOpen(cal, cursor)) {
      remaining -= 1;
      cursor = new Date(cursor.getTime() + 60_000);
    } else {
      break;
    }
  }
  return { cursor, remaining };
}

/**
 * Add `minutes` of business time to `start` according to the calendar.
 * Advances by whole open-window segments when the UTC offset is stable;
 * otherwise falls back to minute steps for that segment.
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  cal: BusinessCalendar = DEFAULT_BUSINESS_CALENDAR,
): Date {
  if (minutes <= 0) return new Date(start);
  let cursor = new Date(start.getTime());
  let remaining = minutes;
  const maxSteps = Math.max(minutes + 10, 10_000);

  for (let guard = 0; guard < maxSteps && remaining > 0; guard += 1) {
    const p = localParts(cursor, cal);
    const { startMinute, endMinute } = cal.hours;
    const openSpan = Math.max(0, endMinute - startMinute);
    if (openSpan <= 0) {
      return new Date(cursor.getTime() + remaining * 60_000);
    }

    if (!isBusinessDay(cal, p.day, p.isoDate) || p.minuteOfDay >= endMinute) {
      const next = addLocalDays(p.y, p.m, p.d, 1);
      cursor = utcFromLocal(next.y, next.m, next.d, startMinute, cal, p.offsetMinutes);
      continue;
    }

    if (p.minuteOfDay < startMinute) {
      cursor = utcFromLocal(p.y, p.m, p.d, startMinute, cal, p.offsetMinutes);
      continue;
    }

    const openLeft = endMinute - p.minuteOfDay;
    const take = Math.min(remaining, openLeft);
    const projected = new Date(cursor.getTime() + take * 60_000);
    const offsetAtEnd = calendarOffset(cal, projected);
    if (offsetAtEnd === p.offsetMinutes) {
      cursor = projected;
      remaining -= take;
      continue;
    }
    // Offset changes inside this open window (DST) — step minute-by-minute.
    const stepped = advanceOpenMinutesMinuteStep(cursor, remaining, cal);
    cursor = stepped.cursor;
    remaining = stepped.remaining;
    if (remaining > 0 && !isOpen(cal, cursor)) {
      // Landed outside the window (e.g. after DST gap); continue outer loop.
      continue;
    }
  }

  return cursor;
}

export function evaluateClock(
  dueAt: Date,
  now: Date,
  atRiskMs = 60 * 60_000,
): "ON_TRACK" | "AT_RISK" | "BREACHED" {
  const left = dueAt.getTime() - now.getTime();
  if (left <= 0) return "BREACHED";
  if (left < atRiskMs) return "AT_RISK";
  return "ON_TRACK";
}

export function calendarFromPolicy(policy: {
  timeZone?: string | null;
  holidays?: unknown;
}): BusinessCalendar {
  const holidays = Array.isArray(policy.holidays)
    ? policy.holidays.filter((d): d is string => typeof d === "string")
    : [];
  const timeZone = policy.timeZone?.trim() || "UTC";
  const utcLike = timeZone === "UTC" || timeZone === "Etc/UTC" || timeZone === "Etc/GMT";
  return {
    timeZone,
    offsetMinutes: utcLike ? 0 : undefined,
    hours: DEFAULT_BUSINESS_CALENDAR.hours,
    holidays,
  };
}

export function businessMinutesBetween(
  start: Date,
  end: Date,
  cal: BusinessCalendar = DEFAULT_BUSINESS_CALENDAR,
): number {
  if (end <= start) return 0;
  let cursor = new Date(start.getTime());
  let count = 0;
  const limit = end.getTime();
  const maxSteps = 366 * 24 * 60;

  for (let guard = 0; guard < maxSteps && cursor.getTime() < limit; guard += 1) {
    const p = localParts(cursor, cal);
    const { startMinute, endMinute } = cal.hours;
    const openSpan = Math.max(0, endMinute - startMinute);
    if (openSpan <= 0) break;

    if (!isBusinessDay(cal, p.day, p.isoDate) || p.minuteOfDay >= endMinute) {
      const next = addLocalDays(p.y, p.m, p.d, 1);
      cursor = utcFromLocal(next.y, next.m, next.d, startMinute, cal, p.offsetMinutes);
      continue;
    }
    if (p.minuteOfDay < startMinute) {
      cursor = utcFromLocal(p.y, p.m, p.d, startMinute, cal, p.offsetMinutes);
      continue;
    }

    const openLeft = endMinute - p.minuteOfDay;
    const exactTake = Math.min(openLeft, Math.floor((limit - cursor.getTime()) / 60_000));
    if (exactTake <= 0) break;
    const projected = new Date(cursor.getTime() + exactTake * 60_000);
    if (calendarOffset(cal, projected) === p.offsetMinutes) {
      count += exactTake;
      if (exactTake < openLeft) break;
      cursor = projected;
      continue;
    }
    // DST inside window: count minute-by-minute until closed or end.
    for (let i = 0; i < exactTake && cursor.getTime() < limit; i += 1) {
      if (isOpen(cal, cursor)) count += 1;
      cursor = new Date(cursor.getTime() + 60_000);
    }
  }
  return count;
}

export function remainingMsAtPause(dueAt: Date, at: Date): number {
  return Math.max(0, dueAt.getTime() - at.getTime());
}

/** @internal test helper */
export function __clearSlaOffsetCache(): void {
  offsetCache.clear();
}

export { isOpen };
