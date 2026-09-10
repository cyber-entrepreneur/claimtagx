import type { Clock } from "../shared/clock.js";
import type { RateLimiter, RateLimitDecision } from "../ports/outbound.js";

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface InMemoryRateLimiterOptions {
  readonly capacity: number;
  readonly refillPerMs: number;
  readonly clock: Clock;
}

/** In-memory token-bucket rate limiter for tests and local development. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly clock: Clock;

  constructor(options: InMemoryRateLimiterOptions) {
    if (options.capacity <= 0) {
      throw new RangeError("capacity must be positive");
    }
    if (options.refillPerMs <= 0) {
      throw new RangeError("refillPerMs must be positive");
    }
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerMs;
    this.clock = options.clock;
  }

  async hit(key: string): Promise<RateLimitDecision> {
    const now = this.clock.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefillMs: now };
    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    const refilled = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.lastRefillMs = now;

    if (refilled >= 1) {
      bucket.tokens = refilled - 1;
      this.buckets.set(key, bucket);
      return { allowed: true };
    }

    bucket.tokens = refilled;
    this.buckets.set(key, bucket);
    const tokensNeeded = 1 - refilled;
    const retryAfterMs = Math.ceil(tokensNeeded / this.refillPerMs);
    return { allowed: false, retryAfterMs };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}
