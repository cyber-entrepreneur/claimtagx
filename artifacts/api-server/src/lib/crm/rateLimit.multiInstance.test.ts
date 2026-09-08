import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rateLimitOk } from "./rateLimit.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("rate-limit multi-instance tests require isolated DATABASE_URL");
  }
}

describe("multi-instance PostgreSQL rate limiting", () => {
  it("two concurrent callers share one fixed window counter", async () => {
    requireIsolatedDb();
    const key = `mi:${randomUUID()}`;
    const max = 5;
    const windowMs = 60_000;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => rateLimitOk(key, max, windowMs)),
    );
    const allowed = results.filter(Boolean).length;
    const denied = results.filter((r) => !r).length;
    assert.equal(allowed, max);
    assert.equal(denied, 8 - max);
  });

  it("per-email public keys are independent of IP keys", async () => {
    requireIsolatedDb();
    const suffix = randomUUID().slice(0, 8);
    assert.equal(await rateLimitOk(`submit:ip:${suffix}`, 1, 60_000), true);
    assert.equal(await rateLimitOk(`submit:ip:${suffix}`, 1, 60_000), false);
    assert.equal(await rateLimitOk(`submit:email:a@${suffix}.example`, 1, 60_000), true);
    assert.equal(await rateLimitOk(`submit:email:b@${suffix}.example`, 1, 60_000), true);
  });
});
