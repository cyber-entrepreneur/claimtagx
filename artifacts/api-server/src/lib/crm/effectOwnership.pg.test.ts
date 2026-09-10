import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("effect CAS tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

async function claimSpecificJob(workerId: string, idempotencyKey: string) {
  const { db, crmJobsTable } = await import("@workspace/db");
  const { eq, sql } = await import("drizzle-orm");
  const [job] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.idempotencyKey, idempotencyKey)).limit(1);
  if (!job) throw new Error(`job ${idempotencyKey} not enqueued`);
  const [updated] = await db
    .update(crmJobsTable)
    .set({
      status: "running",
      lockedBy: workerId,
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
      attempts: sql`${crmJobsTable.attempts} + 1`,
    })
    .where(eq(crmJobsTable.id, job.id))
    .returning();
  if (!updated) throw new Error("failed to claim test job");
  return updated;
}

function leaseCtx(workerId: string, jobId: string, claimGeneration: number) {
  return { jobId, workerId, claimGeneration, signal: new AbortController().signal };
}

describe("effect ownership CAS", () => {
  it("rejects stale worker commit/fail/uncertain/heartbeat after reclaim and allows the new owner to commit", async () => {
    requireIsolatedDb();
    const { db, crmJobEffectsTable, crmAnalyticsEventsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const effects = await import("./effects.ts");
    const { enqueueJob } = await import("./queue.ts");
    const key = `cas:${randomUUID()}`;
    const event = `cas_${key.slice(-8)}`;
    await enqueueJob("test_cas", { key }, { idempotencyKey: `job-${key}` });
    const jobA = await claimSpecificJob("worker-a", `job-${key}`);
    assert.ok(jobA);
    const ctxA = leaseCtx("worker-a", jobA.id, jobA.claimGeneration);
    const leaseA = await db.transaction((tx) =>
      effects.claimEffectForWork(tx, { key, kind: "analytics", payload: { event }, ctx: ctxA }),
    );
    assert.ok(leaseA);
    await db
      .update(crmJobEffectsTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 5_000) })
      .where(eq(crmJobEffectsTable.idempotencyKey, key));
    await enqueueJob("test_cas_b", { key }, { idempotencyKey: `job-b-${key}` });
    const jobB = await claimSpecificJob("worker-b", `job-b-${key}`);
    assert.ok(jobB);
    const ctxB = leaseCtx("worker-b", jobB.id, jobB.claimGeneration);
    const leaseB = await db.transaction((tx) =>
      effects.claimEffectForWork(tx, { key, kind: "analytics", payload: { event }, ctx: ctxB }),
    );
    assert.ok(leaseB);
    assert.ok(leaseB.claimGeneration > leaseA.claimGeneration);
    const staleCommit = await db.transaction(async (tx) => {
      try {
        await effects.commitEffect(tx, leaseA, ctxA);
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(staleCommit, false);
    assert.equal(await effects.failEffect(leaseA, "stale fail"), false);
    assert.equal(await effects.failEffect(leaseA, "stale uncertain", { uncertain: true }), false);
    assert.equal(await effects.heartbeatEffect(leaseA), false);
    await db.transaction(async (tx) => {
      await tx.insert(crmAnalyticsEventsTable).values({ event, properties: {} });
      await effects.commitEffect(tx, leaseB, ctxB);
    });
    const [row] = await db.select().from(crmJobEffectsTable).where(eq(crmJobEffectsTable.idempotencyKey, key));
    assert.equal(row?.status, "committed");
    assert.equal(row?.claimGeneration, leaseB.claimGeneration);
  });

  it("produces exactly one winner for concurrent commits of the same lease", async () => {
    requireIsolatedDb();
    const { db, crmJobEffectsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const effects = await import("./effects.ts");
    const key = `conc:${randomUUID()}`;
    const lease = await db.transaction((tx) =>
      effects.claimEffectForWork(tx, { key, kind: "analytics", payload: { n: 1 } }),
    );
    assert.ok(lease);
    const results = await Promise.allSettled([
      db.transaction((tx) => effects.commitEffect(tx, lease)),
      db.transaction((tx) => effects.commitEffect(tx, lease)),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled").length;
    const losses = results.filter((r) => r.status === "rejected").length;
    assert.equal(wins, 1);
    assert.equal(losses, 1);
    const [row] = await db.select().from(crmJobEffectsTable).where(eq(crmJobEffectsTable.idempotencyKey, key));
    assert.equal(row?.status, "committed");
  });

  it("produces one valid outcome for concurrent fail versus commit", async () => {
    requireIsolatedDb();
    const { db, crmJobEffectsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const effects = await import("./effects.ts");
    const key = `race:${randomUUID()}`;
    const lease = await db.transaction((tx) =>
      effects.claimEffectForWork(tx, { key, kind: "analytics", payload: { n: 1 } }),
    );
    assert.ok(lease);
    const [commitRes, failRes] = await Promise.all([
      db.transaction(async (tx) => {
        try {
          await effects.commitEffect(tx, lease);
          return "committed";
        } catch {
          return "lost";
        }
      }),
      effects.failEffect(lease, "race"),
    ]);
    const [row] = await db.select().from(crmJobEffectsTable).where(eq(crmJobEffectsTable.idempotencyKey, key));
    const status = row?.status;
    assert.ok(status === "committed" || status === "retryable_failed");
    if (status === "committed") {
      assert.equal(commitRes, "committed");
      assert.equal(failRes, false);
    } else {
      assert.equal(failRes, true);
      assert.equal(commitRes, "lost");
    }
  });

  it("rejects job claim generation mismatch and processing-token mismatch", async () => {
    requireIsolatedDb();
    const { db } = await import("@workspace/db");
    const effects = await import("./effects.ts");
    const { enqueueJob } = await import("./queue.ts");
    const key = `mismatch:${randomUUID()}`;
    await enqueueJob("test_mismatch", {}, { idempotencyKey: `job-${key}` });
    const job = await claimSpecificJob("worker-m", `job-${key}`);
    assert.ok(job);
    const ctx = leaseCtx("worker-m", job.id, job.claimGeneration);
    const lease = await db.transaction((tx) =>
      effects.claimEffectForWork(tx, { key, kind: "analytics", payload: { n: 1 }, ctx }),
    );
    assert.ok(lease);
    await assert.rejects(() =>
      db.transaction((tx) => effects.commitEffect(tx, { ...lease, jobClaimGeneration: lease.jobClaimGeneration! + 1 }, ctx)),
    );
    await assert.rejects(() =>
      db.transaction((tx) => effects.commitEffect(tx, { ...lease, processingToken: randomUUID() }, ctx)),
    );
  });

  it("rolls back domain mutation when commit loses ownership", async () => {
    requireIsolatedDb();
    const { db, crmJobEffectsTable, crmAnalyticsEventsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const effects = await import("./effects.ts");
    const { enqueueJob } = await import("./queue.ts");
    const key = `dom:${randomUUID()}`;
    const event = `dom_${key.slice(-8)}`;
    await enqueueJob("test_dom_a", { key }, { idempotencyKey: `dom-a-${key}` });
    await enqueueJob("test_dom_b", { key }, { idempotencyKey: `dom-b-${key}` });
    const jobA = await claimSpecificJob("a", `dom-a-${key}`);
    const jobBrow = await claimSpecificJob("b", `dom-b-${key}`);
    assert.ok(jobA && jobBrow);
    const leaseA = await db.transaction((tx) =>
      effects.claimEffectForWork(tx, {
        key,
        kind: "analytics",
        payload: { event },
        ctx: leaseCtx("a", jobA.id, jobA.claimGeneration),
      }),
    );
    assert.ok(leaseA);
    await db
      .update(crmJobEffectsTable)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(crmJobEffectsTable.idempotencyKey, key));
    const leaseB = await db.transaction((tx) =>
      effects.claimEffectForWork(tx, {
        key,
        kind: "analytics",
        payload: { event },
        ctx: leaseCtx("b", jobBrow.id, jobBrow.claimGeneration),
      }),
    );
    assert.ok(leaseB);
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        await tx.insert(crmAnalyticsEventsTable).values({ event, properties: { stale: true } });
        await effects.commitEffect(tx, leaseA);
      }),
    );
    const rows = await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event));
    assert.equal(rows.length, 0);
    await db.transaction(async (tx) => {
      await tx.insert(crmAnalyticsEventsTable).values({ event, properties: { owner: "b" } });
      await effects.commitEffect(tx, leaseB);
    });
    const rows2 = await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event));
    assert.equal(rows2.length, 1);
  });
});
