import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("effect tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("durable job-effect lifecycle", () => {
  it("commits analytics mutation and effect in one transaction", async () => {
    requireIsolatedDb();
    const { db, crmAnalyticsEventsTable, crmJobEffectsTable } = await import("@workspace/db");
    const { applyTransactionalDbEffect } = await import("./effects.ts");
    const { eq } = await import("drizzle-orm");
    const event = `fx_${randomUUID().slice(0, 8)}`;
    const key = `analytics:test:${event}`;
    await applyTransactionalDbEffect({
      key,
      kind: "analytics",
      payload: { event },
      work: async (tx) => {
        await tx.insert(crmAnalyticsEventsTable).values({ event, properties: {} });
      },
    });
    const effects = await db.select().from(crmJobEffectsTable).where(eq(crmJobEffectsTable.idempotencyKey, key));
    assert.equal(effects[0]?.status, "committed");
    const rows = await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event));
    assert.equal(rows.length, 1);
    const again = await applyTransactionalDbEffect({
      key,
      kind: "analytics",
      payload: { event },
      work: async (tx) => {
        await tx.insert(crmAnalyticsEventsTable).values({ event, properties: { dup: true } });
      },
    });
    assert.equal(again, "skipped");
    const rows2 = await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event));
    assert.equal(rows2.length, 1);
  });

  it("rolls back both mutation and effect when work throws after reservation", async () => {
    requireIsolatedDb();
    const { db, crmAnalyticsEventsTable, crmJobEffectsTable } = await import("@workspace/db");
    const { applyTransactionalDbEffect } = await import("./effects.ts");
    const { eq } = await import("drizzle-orm");
    const event = `rb_${randomUUID().slice(0, 8)}`;
    const key = `analytics:test:${event}`;
    await assert.rejects(() =>
      applyTransactionalDbEffect({
        key,
        kind: "analytics",
        payload: { event },
        work: async (tx) => {
          await tx.insert(crmAnalyticsEventsTable).values({ event, properties: {} });
          throw new Error("injected failure after domain mutation");
        },
      }),
    );
    const effects = await db.select().from(crmJobEffectsTable).where(eq(crmJobEffectsTable.idempotencyKey, key));
    assert.equal(effects.length, 0);
    const rows = await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event));
    assert.equal(rows.length, 0);
  });

  it("rejects idempotency collision with a different payload", async () => {
    requireIsolatedDb();
    const { applyTransactionalDbEffect, EffectPayloadCollisionError } = await import("./effects.ts");
    const { crmAnalyticsEventsTable } = await import("@workspace/db");
    const key = `analytics:collision:${randomUUID()}`;
    await applyTransactionalDbEffect({
      key,
      kind: "analytics",
      payload: { event: "a" },
      work: async (tx) => {
        await tx.insert(crmAnalyticsEventsTable).values({ event: `c_${key.slice(-8)}`, properties: {} });
      },
    });
    await assert.rejects(
      () =>
        applyTransactionalDbEffect({
          key,
          kind: "analytics",
          payload: { event: "b" },
          work: async () => undefined,
        }),
      EffectPayloadCollisionError,
    );
  });
});
