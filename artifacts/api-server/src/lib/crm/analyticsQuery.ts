export function parseAnalyticsWindow(query: {
  from?: unknown;
  to?: unknown;
  timeZone?: unknown;
}): { from: Date | null; to: Date | null; timeZone: string } {
  const timeZone = typeof query.timeZone === "string" && query.timeZone.trim() ? query.timeZone.trim() : "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw Object.assign(new Error(`Invalid IANA time zone: ${timeZone}`), { status: 400 });
  }
  const from = typeof query.from === "string" && query.from ? new Date(query.from) : null;
  const to = typeof query.to === "string" && query.to ? new Date(query.to) : null;
  if (from && Number.isNaN(from.getTime())) {
    throw Object.assign(new Error("Invalid from date"), { status: 400 });
  }
  if (to && Number.isNaN(to.getTime())) {
    throw Object.assign(new Error("Invalid to date"), { status: 400 });
  }
  if (from && to && from > to) {
    throw Object.assign(new Error("from must be before to"), { status: 400 });
  }
  return { from, to, timeZone };
}

export function analyticsCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "metric,value\n";
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const body = rows
    .map((row) => keys.map((k) => JSON.stringify(row[k] ?? "")).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}
