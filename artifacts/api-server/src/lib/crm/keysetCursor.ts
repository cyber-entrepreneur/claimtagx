/**
 * Stable createdAt+id (or createdAt+key) cursors for operational lists.
 * Offset pagination is not used for these surfaces.
 */
export type TimeIdCursor = { createdAt: Date; id: string };

export function encodeTimeIdCursor(row: TimeIdCursor): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), i: row.id }), "utf8").toString("base64url");
}

export function decodeTimeIdCursor(raw: string): TimeIdCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: string; i?: string };
    if (!parsed.t || !parsed.i) return null;
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}

export function boundedPageSize(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.min(Math.max(fallback, 1), max);
  return Math.min(Math.max(n, 1), max);
}
