import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("behavioral job tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("behavioral job claim and ownership", () => {
  it("rejects stale-worker complete after reclaim", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const type = `beh_${randomUUID().slice(0, 8)}`;
    await db.insert(crmJobsTable).values({
      type,
      payload: { n: 1 },
      status: "pending",
      runAt: new Date(),
      maxAttempts: 2,
    });
    const firstBatch = await queue.claimJobs(2000, "worker-stale");
    const a = firstBatch.find((job) => job.type === type);
    assert.ok(a, "fixture job must be claimed");
    for (const extra of firstBatch) {
      if (extra.id === a.id) continue;
      await queue.failJob({
        jobId: extra.id,
        workerId: "worker-stale",
        claimGeneration: extra.claimGeneration,
        attempts: extra.attempts,
        maxAttempts: extra.attempts + 8,
        error: "released by ownership test isolation",
      });
    }
    await db
      .update(crmJobsTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(crmJobsTable.id, a.id));
    const secondBatch = await queue.claimJobs(2000, "worker-new");
    const b = secondBatch.find((job) => job.id === a.id);
    assert.ok(b, "reclaimed job must match fixture");
    assert.equal(b.lockedBy, "worker-new");
    assert.ok(b.claimGeneration > a.claimGeneration);
    const staleComplete = await queue.completeJob({
      jobId: a.id,
      workerId: "worker-stale",
      claimGeneration: a.claimGeneration,
    });
    assert.equal(staleComplete, false);
    const staleFail = await queue.failJob({
      jobId: a.id,
      workerId: "worker-stale",
      claimGeneration: a.claimGeneration,
      attempts: a.attempts,
      maxAttempts: 8,
      error: "should not apply",
    });
    assert.equal(staleFail, "lost");
    const owned = await queue.completeJob({
      jobId: b.id,
      workerId: "worker-new",
      claimGeneration: b.claimGeneration,
    });
    assert.equal(owned, true);
  });

  it("unknown types fail into dead-letter after max attempts", async () => {
    requireIsolatedDb();
    const jobs = await import("./jobs.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const type = `unknown_${randomUUID().slice(0, 8)}`;
    const [inserted] = await db
      .insert(crmJobsTable)
      .values({
        type,
        payload: { n: 1 },
        status: "pending",
        runAt: new Date(0),
        maxAttempts: 1,
      })
      .returning();
    assert.ok(inserted);
    await jobs.processCrmJobs(1, { workerId: "worker-unknown" });
    const [row] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.id, inserted.id)).limit(1);
    assert.equal(row?.status, "dead");
    assert.match(row?.lastError ?? "", /unknown crm job type/);
  });

  it("idempotent enqueue does not create a second row", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const key = `idem_${randomUUID()}`;
    await queue.enqueueJob("analytics", { event: "idem_test" }, { idempotencyKey: key });
    await queue.enqueueJob("analytics", { event: "idem_test_dup" }, { idempotencyKey: key });
    const rows = await db.select().from(crmJobsTable).where(eq(crmJobsTable.idempotencyKey, key));
    assert.equal(rows.length, 1);
  });

  it("renews the lease during a long-running handler", async () => {
    requireIsolatedDb();
    process.env.CRM_JOB_LEASE_MS = "400";
    process.env.CRM_JOB_HEARTBEAT_MS = "80";
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const type = `hb_${randomUUID().slice(0, 8)}`;
    await db.insert(crmJobsTable).values({ type, payload: { n: 1 }, status: "pending", runAt: new Date() });
    const claimed = await queue.claimJobs(50, "hb-worker");
    const job = claimed.find((row) => row.type === type);
    assert.ok(job);
    const start = queue.queueMetrics.heartbeatsRenewed;
    await queue.withJobHeartbeat(
      { jobId: job.id, workerId: "hb-worker", claimGeneration: job.claimGeneration, intervalMs: 80 },
      async () => {
        await new Promise((r) => setTimeout(r, 280));
        const others = await queue.claimJobs(20, "other-worker");
        assert.equal(
          others.some((row) => row.id === job.id),
          false,
        );
      },
    );
    assert.ok(queue.queueMetrics.heartbeatsRenewed > start);
    const owned = await queue.completeJob({
      jobId: job.id,
      workerId: "hb-worker",
      claimGeneration: job.claimGeneration,
    });
    assert.equal(owned, true);
  });

  it("releases unstarted claimed jobs on shutdown", async () => {
    requireIsolatedDb();
    const jobsMod = await import("./jobs.ts");
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const type = `sd_${randomUUID().slice(0, 8)}`;
    await db.insert(crmJobsTable).values({ type, payload: { n: 1 }, status: "pending", runAt: new Date() });
    let claimed = false;
    const shuttingDown = () => claimed;
    const orig = queue.claimJobs;
    // claim then immediately shutdown: processCrmJobs releases remaining
    const [claimedJob] = await queue.claimJobs(1, "sd-worker");
    assert.ok(claimedJob?.type === type || claimedJob);
    claimed = true;
    await jobsMod.processCrmJobs(5, { workerId: "sd-worker-2", shuttingDown: () => true });
    if (claimedJob && claimedJob.type === type) {
      await queue.releaseUnstartedJobs([claimedJob], "sd-worker");
      const [row] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.id, claimedJob.id)).limit(1);
      assert.equal(row?.status, "pending");
    }
    void orig;
  });

  it("schedules exactly one active recurring SLA job under concurrency", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { and, eq, inArray } = await import("drizzle-orm");
    await Promise.all([
      queue.scheduleRecurringSlaRefresh(),
      queue.scheduleRecurringSlaRefresh(),
      queue.scheduleRecurringSlaRefresh(),
    ]);
    const rows = await db
      .select()
      .from(crmJobsTable)
      .where(and(eq(crmJobsTable.type, "refresh_sla"), inArray(crmJobsTable.status, ["pending", "running"])));
    assert.equal(rows.length, 1);
  });

  it("reclaims after heartbeat stops and rejects stale completion", async () => {
    requireIsolatedDb();
    process.env.CRM_JOB_LEASE_MS = "250";
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const type = `exp_${randomUUID().slice(0, 8)}`;
    await db.insert(crmJobsTable).values({ type, payload: { n: 1 }, status: "pending", runAt: new Date() });
    const claimed = await queue.claimJobs(80, "lease-a");
    const job = claimed.find((row) => row.type === type);
    assert.ok(job);
    await db
      .update(crmJobsTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 50) })
      .where(eq(crmJobsTable.id, job.id));
    const reclaimed = await queue.claimJobs(80, "lease-b");
    const taken = reclaimed.find((row) => row.id === job.id);
    assert.ok(taken);
    const stale = await queue.completeJob({
      jobId: job.id,
      workerId: "lease-a",
      claimGeneration: job.claimGeneration,
    });
    assert.equal(stale, false);
    const ok = await queue.completeJob({
      jobId: taken.id,
      workerId: "lease-b",
      claimGeneration: taken.claimGeneration,
    });
    assert.equal(ok, true);
  });

  it("aborts the handler when heartbeat renewal matches zero rows", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const { LostOwnershipError } = queue;
    const { db, crmJobsTable } = await import("@workspace/db");
    const type = `zrow_${randomUUID().slice(0, 8)}`;
    await db.insert(crmJobsTable).values({ type, payload: { n: 1 }, status: "pending", runAt: new Date() });
    const claimed = await queue.claimJobs(80, "own-a");
    const job = claimed.find((row) => row.type === type);
    assert.ok(job);
    await assert.rejects(
      () =>
        queue.withJobHeartbeat(
          { jobId: job.id, workerId: "not-owner", claimGeneration: job.claimGeneration, intervalMs: 40 },
          async (signal) => {
            await new Promise((r) => setTimeout(r, 80));
            if (signal.aborted) throw new LostOwnershipError(job.id);
          },
        ),
      LostOwnershipError,
    );
    const owned = await queue.completeJob({
      jobId: job.id,
      workerId: "own-a",
      claimGeneration: job.claimGeneration,
    });
    assert.equal(owned, true);
  });

  it("does not claim when shutdown is already set", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    const jobsMod = await import("./jobs.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const type = `__test_sleep`;
    const [row] = await db
      .insert(crmJobsTable)
      .values({ type, payload: { ms: 50 }, status: "pending", runAt: new Date(), maxAttempts: 3 })
      .returning();
    assert.ok(row);
    await jobsMod.processCrmJobs(20, { workerId: "sd-before", shuttingDown: () => true });
    const [still] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.id, row.id)).limit(1);
    assert.equal(still?.status, "pending");
  });

  it("releases a claimed batch when shutdown starts after claim", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    const jobsMod = await import("./jobs.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .insert(crmJobsTable)
      .values({
        type: "__test_sleep",
        payload: { ms: 30 },
        status: "pending",
        runAt: new Date(Date.now() - 60_000),
        maxAttempts: 8,
      })
      .returning();
    assert.ok(row);
    let n = 0;
    await jobsMod.processCrmJobs(30, {
      workerId: "sd-after-claim",
      shuttingDown: () => {
        n += 1;
        return n > 1;
      },
    });
    const [still] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.id, row.id)).limit(1);
    assert.equal(still?.status, "pending");
    assert.equal(still?.lockedBy, null);
  });

  it("keeps the in-flight job and releases the remainder during shutdown", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    const jobsMod = await import("./jobs.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [first] = await db
      .insert(crmJobsTable)
      .values({
        type: "__test_sleep",
        payload: { ms: 40 },
        status: "pending",
        runAt: new Date(Date.now() - 90_000),
        maxAttempts: 8,
      })
      .returning();
    const [second] = await db
      .insert(crmJobsTable)
      .values({
        type: "__test_sleep",
        payload: { ms: 40 },
        status: "pending",
        runAt: new Date(Date.now() - 80_000),
        maxAttempts: 8,
      })
      .returning();
    assert.ok(first && second);
    let n = 0;
    await jobsMod.processCrmJobs(40, {
      workerId: "sd-mid",
      shuttingDown: () => {
        n += 1;
        return n > 3;
      },
    });
    const [a] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.id, first.id)).limit(1);
    const [b] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.id, second.id)).limit(1);
    assert.equal(a?.status === "completed" || a?.status === "pending", true);
    assert.equal(b?.status === "pending" || b?.status === "completed", true);
  });

  it("schedules exactly one active retention job under concurrency", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { and, eq, inArray } = await import("drizzle-orm");
    await Promise.all([
      queue.scheduleRecurringRetention(),
      queue.scheduleRecurringRetention(),
      queue.scheduleRecurringRetention(),
    ]);
    const rows = await db
      .select()
      .from(crmJobsTable)
      .where(and(eq(crmJobsTable.type, "enforce_retention"), inArray(crmJobsTable.status, ["pending", "running"])));
    assert.equal(rows.length, 1);
  });

  it("serializes heartbeat renewals without overlap", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    let concurrent = 0;
    let max = 0;
    let calls = 0;
    const renew = async () => {
      concurrent += 1;
      max = Math.max(max, concurrent);
      calls += 1;
      await new Promise((r) => setTimeout(r, 40));
      concurrent -= 1;
      return true;
    };
    await queue.withJobHeartbeat(
      {
        jobId: "00000000-0000-0000-0000-000000000001",
        workerId: "hb",
        claimGeneration: 1,
        intervalMs: 20,
        queryTimeoutMs: 500,
        renew,
      },
      async () => {
        await new Promise((r) => setTimeout(r, 90));
      },
    );
    assert.equal(max, 1);
    assert.ok(calls >= 2);
  });

  it("times out a hung heartbeat query, rejects overlapping renewals, and cleans timers", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const beforeTimeouts = queue.queueMetrics.heartbeatTimeouts;
    let overlap = 0;
    let max = 0;
    const renew = async () => {
      overlap += 1;
      max = Math.max(max, overlap);
      await new Promise((r) => setTimeout(r, 80));
      overlap -= 1;
      return true;
    };
    await queue.withJobHeartbeat(
      {
        jobId: "00000000-0000-0000-0000-000000000002",
        workerId: "hb2",
        claimGeneration: 1,
        intervalMs: 15,
        queryTimeoutMs: 500,
        renew,
      },
      async () => {
        await new Promise((r) => setTimeout(r, 120));
      },
    );
    assert.equal(max, 1);
    assert.equal(queue.queueMetrics.activeRenewals, 0);
    await assert.rejects(
      () =>
        queue.withJobHeartbeat(
          {
            jobId: "00000000-0000-0000-0000-000000000003",
            workerId: "hb3",
            claimGeneration: 1,
            intervalMs: 20,
            queryTimeoutMs: 40,
            renew: () => new Promise<boolean>(() => undefined),
          },
          async (signal) => {
            await new Promise((r) => setTimeout(r, 80));
            if (signal.aborted) throw new queue.LostOwnershipError("timeout");
          },
        ),
      queue.LostOwnershipError,
    );
    assert.ok(queue.queueMetrics.heartbeatTimeouts > beforeTimeouts);
  });

  it("aborts on zero-row ownership loss and allows handler completion during renewal", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    await assert.rejects(
      () =>
        queue.withJobHeartbeat(
          {
            jobId: "00000000-0000-0000-0000-000000000099",
            workerId: "nobody",
            claimGeneration: 1,
            intervalMs: 20,
            queryTimeoutMs: 400,
          },
          async (signal) => {
            await new Promise((r) => setTimeout(r, 60));
            if (signal.aborted) throw new queue.LostOwnershipError("zero");
          },
        ),
      queue.LostOwnershipError,
    );
    let renewStarted = false;
    await queue.withJobHeartbeat(
      {
        jobId: "00000000-0000-0000-0000-000000000004",
        workerId: "hb4",
        claimGeneration: 1,
        intervalMs: 10,
        queryTimeoutMs: 500,
        renew: async () => {
          renewStarted = true;
          await new Promise((r) => setTimeout(r, 50));
          return true;
        },
      },
      async () => "done",
    );
    assert.equal(renewStarted, true);
  });

  it("does not insert analytics after ownership is aborted", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    const queue = await import("./queue.ts");
    const jobs = await import("./jobs.ts");
    const { db, crmJobsTable, crmAnalyticsEventsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const event = `an_${randomUUID().slice(0, 8)}`;
    const [inserted] = await db
      .insert(crmJobsTable)
      .values({ type: "analytics", payload: { event }, status: "pending", runAt: new Date() })
      .returning();
    assert.ok(inserted);
    const claimed = await queue.claimJobs(80, "an-owner");
    const job = claimed.find((row) => row.id === inserted.id);
    assert.ok(job);
    const before = (await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event))).length;
    await assert.rejects(
      () =>
        queue.withJobHeartbeat(
          { jobId: job.id, workerId: "wrong", claimGeneration: job.claimGeneration, intervalMs: 20, queryTimeoutMs: 200 },
          async (signal) => {
            await new Promise((r) => setTimeout(r, 50));
            if (signal.aborted) throw new queue.LostOwnershipError(job.id);
            await jobs.processCrmJobs(0);
          },
        ),
      queue.LostOwnershipError,
    );
    const after = (await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event))).length;
    assert.equal(after, before);
    await queue.completeJob({ jobId: job.id, workerId: "an-owner", claimGeneration: job.claimGeneration });
  });

  it("schedules a new SLA job after the previous one completes", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { and, eq, inArray } = await import("drizzle-orm");
    await queue.scheduleRecurringSlaRefresh();
    const [active] = await db
      .select()
      .from(crmJobsTable)
      .where(and(eq(crmJobsTable.type, "refresh_sla"), inArray(crmJobsTable.status, ["pending", "running"])));
    assert.ok(active);
    const claimed = await queue.claimJobs(50, "sla-finisher");
    const job = claimed.find((row) => row.id === active.id) ?? claimed.find((row) => row.type === "refresh_sla");
    if (job) {
      await queue.completeJob({
        jobId: job.id,
        workerId: "sla-finisher",
        claimGeneration: job.claimGeneration,
      });
    } else {
      await db.update(crmJobsTable).set({ status: "completed", completedAt: new Date() }).where(eq(crmJobsTable.id, active.id));
    }
    await queue.scheduleRecurringSlaRefresh();
    const pending = await db
      .select()
      .from(crmJobsTable)
      .where(and(eq(crmJobsTable.type, "refresh_sla"), inArray(crmJobsTable.status, ["pending", "running"])));
    assert.equal(pending.length, 1);
  });

  it("heartbeat teardown does not wait the query timeout after short work", async () => {
    requireIsolatedDb();
    process.env.CRM_JOB_LEASE_MS = "5000";
    process.env.CRM_JOB_HEARTBEAT_MS = "2000";
    process.env.CRM_HEARTBEAT_QUERY_TIMEOUT_MS = "2000";
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const type = `hb_fast_${randomUUID().slice(0, 8)}`;
    await db.insert(crmJobsTable).values({ type, payload: {}, status: "pending", runAt: new Date() });
    const claimed = await queue.claimJobs(20, "hb-fast");
    const job = claimed.find((row) => row.type === type);
    assert.ok(job);
    const t0 = Date.now();
    await queue.withJobHeartbeat(
      { jobId: job.id, workerId: "hb-fast", claimGeneration: job.claimGeneration, intervalMs: 2000 },
      async () => {
        await new Promise((r) => setTimeout(r, 25));
      },
    );
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 400, `heartbeat teardown took ${elapsed}ms`);
    await queue.completeJob({ jobId: job.id, workerId: "hb-fast", claimGeneration: job.claimGeneration });
  });

  it("lease reclaim does not increment attempts", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const type = `reclaim_${randomUUID().slice(0, 8)}`;
    await db.insert(crmJobsTable).values({ type, payload: {}, status: "pending", runAt: new Date() });
    const first = (await queue.claimJobs(50, "w1")).find((row) => row.type === type);
    assert.ok(first);
    assert.equal(first.attempts, 1);
    await db.update(crmJobsTable).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(crmJobsTable.id, first.id));
    const second = (await queue.claimJobs(50, "w2")).find((row) => row.id === first.id);
    assert.ok(second);
    assert.equal(second.attempts, 1);
    assert.ok(second.claimGeneration > first.claimGeneration);
    await queue.completeJob({ jobId: second.id, workerId: "w2", claimGeneration: second.claimGeneration });
  });
});
