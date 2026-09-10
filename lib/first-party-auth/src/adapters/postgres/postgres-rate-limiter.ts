import { eq } from "drizzle-orm";
import type { Clock } from "../../shared/clock.js";
import type { RateLimiter, RateLimitDecision } from "../../ports/outbound.js";
import type { AuthDatabase } from "./database.js";
import { authRateLimits } from "./schema.js";

export interface RateLimitTables {
  readonly rateLimits: typeof authRateLimits;
}

export interface PostgresRateLimiterOptions {
  readonly capacity: number;
  readonly refillPerMs: number;
  readonly clock: Clock;
  readonly tables?: RateLimitTables;
}

/**
 * Multi-instance token-bucket {@link RateLimiter} backed by a shared Postgres
 * table. Each `hit` runs in a transaction that locks the bucket row
 * (`SELECT ... FOR UPDATE`), refills based on elapsed time, and consumes a
 * token — so concurrent API instances throttle against the same counter rather
 * than each keeping a private in-memory bucket.
 */
export class PostgresRateLimiter implements RateLimiter {
  private readonly rateLimits: typeof authRateLimits;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly clock: Clock;

  constructor(
    private readonly db: AuthDatabase,
    options: PostgresRateLimiterOptions,
  ) {
    if (options.capacity <= 0) {
      throw new RangeError("capacity must be positive");
    }
    if (options.refillPerMs <= 0) {
      throw new RangeError("refillPerMs must be positive");
    }
    this.rateLimits = options.tables?.rateLimits ?? authRateLimits;
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerMs;
    this.clock = options.clock;
  }

  async hit(key: string): Promise<RateLimitDecision> {
    const now = this.clock.now();
    const rateLimits = this.rateLimits;
    const capacity = this.capacity;
    const refillPerMs = this.refillPerMs;

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(rateLimits)
        .where(eq(rateLimits.key, key))
        .limit(1)
        .for("update");
      const existing = rows[0];

      const previousTokens = existing?.tokens ?? capacity;
      const lastRefillMs = existing?.lastRefillMs ?? now;
      const elapsed = Math.max(0, now - lastRefillMs);
      const refilled = Math.min(capacity, previousTokens + elapsed * refillPerMs);

      const allowed = refilled >= 1;
      const remaining = allowed ? refilled - 1 : refilled;

      await tx
        .insert(rateLimits)
        .values({ key, tokens: remaining, lastRefillMs: now })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: { tokens: remaining, lastRefillMs: now },
        });

      if (allowed) {
        return { allowed: true };
      }
      return { allowed: false, retryAfterMs: Math.ceil((1 - refilled) / refillPerMs) };
    });
  }

  async reset(key: string): Promise<void> {
    await this.db.delete(this.rateLimits).where(eq(this.rateLimits.key, key));
  }
}
