import { db, crmRateLimitsTable } from "@workspace/db";
import { lt, sql } from "drizzle-orm";

let lastCompactAt = 0;

/**
 * Drop rate-limit buckets older than retentionMs so the table cannot grow without bounds.
 */
export async function compactRateLimitBuckets(retentionMs = 24 * 60 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - retentionMs);
  const deleted = await db
    .delete(crmRateLimitsTable)
    .where(lt(crmRateLimitsTable.windowStartedAt, cutoff))
    .returning({ key: crmRateLimitsTable.bucketKey });
  return deleted.length;
}

/**
 * Postgres-backed fixed-window rate limiter safe across API replicas.
 * Returns true when the request is allowed.
 */
export async function rateLimitOk(
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && process.env.CRM_TEST_SUBMIT_FAIL_AT === "rate_limit_tx") {
    throw Object.assign(new Error("injected rate-limit transaction failure"), {
      code: "40P01",
      status: 503,
    });
  }
  const now = new Date();
  const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const windowStartedAt = new Date(windowStartMs);

  // Opportunistic compaction at most once per 15 minutes per process.
  if (now.getTime() - lastCompactAt > 15 * 60_000) {
    lastCompactAt = now.getTime();
    void compactRateLimitBuckets().catch(() => undefined);
  }

  const [row] = await db
    .insert(crmRateLimitsTable)
    .values({
      bucketKey: key,
      windowStartedAt,
      count: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: crmRateLimitsTable.bucketKey,
      set: {
        count: sql`CASE
          WHEN ${crmRateLimitsTable.windowStartedAt} = ${windowStartedAt} THEN ${crmRateLimitsTable.count} + 1
          ELSE 1
        END`,
        windowStartedAt,
        updatedAt: now,
      },
    })
    .returning({ count: crmRateLimitsTable.count });

  return (row?.count ?? max + 1) <= max;
}
