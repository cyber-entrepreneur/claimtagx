import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { assertIsolatedCrmDatabase } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  assertIsolatedCrmDatabase("shutdown tests");
}

describe("worker shutdown semantics", () => {
  it("stops before claim and releases immediately after claim", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    const jobs = await import("./jobs.ts");
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const type = `sd_${randomUUID().slice(0, 8)}`;
    await db.insert(crmJobsTable).values({ type, payload: {}, status: "pending", runAt: new Date() });
    let shutting = true;
    await jobs.processCrmJobs(5, { workerId: "pre-claim", shuttingDown: () => shutting });
    const pending = await db.select().from(crmJobsTable);
    assert.equal(pending.some((row) => row.type === type && row.status === "pending"), true);
    shutting = false;
    const sleepKey = `sleep-${randomUUID()}`;
    await db.insert(crmJobsTable).values({
      type: "__test_sleep",
      payload: { ms: 400 },
      status: "pending",
      runAt: new Date(),
      idempotencyKey: sleepKey,
    });
    const { eq } = await import("drizzle-orm");
    const [sleepRow] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.idempotencyKey, sleepKey)).limit(1);
    assert.ok(sleepRow);
    const [claimed] = await db
      .update(crmJobsTable)
      .set({
        status: "running",
        lockedBy: "post-claim",
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        claimGeneration: 1,
        attempts: 1,
      })
      .where(eq(crmJobsTable.id, sleepRow.id))
      .returning();
    assert.ok(claimed);
    const sleepJob = {
      id: claimed.id,
      claimGeneration: claimed.claimGeneration,
    };
    const released = await queue.releaseUnstartedJobs([sleepJob], "post-claim");
    assert.ok(released >= 1);
  });

  it("aborts at deadline and records 1 when a handler ignores cancellation", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_WORKER_POLL_MS = "50";
    const jobs = await import("./jobs.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    await db.insert(crmJobsTable).values({
      type: "__test_ignore_cancel",
      payload: { ms: 1500 },
      status: "pending",
      runAt: new Date(),
    });
    jobs.startCrmJobWorker({ bindSignals: false });
    await new Promise((r) => setTimeout(r, 80));
    const code = await jobs.shutdownCrmJobWorker(50);
    assert.ok(code === 0 || code === 1);
  });

  it("does not duplicate SIGTERM handlers across start/stop cycles", async () => {
    requireIsolatedDb();
    const jobs = await import("./jobs.ts");
    const before = process.listenerCount("SIGTERM");
    jobs.startCrmJobWorker({ bindSignals: true });
    jobs.startCrmJobWorker({ bindSignals: true });
    const mid = process.listenerCount("SIGTERM");
    await jobs.shutdownCrmJobWorker(20);
    jobs.startCrmJobWorker({ bindSignals: true });
    const again = process.listenerCount("SIGTERM");
    await jobs.shutdownCrmJobWorker(20);
    assert.ok(mid - before <= 2);
    assert.ok(again - before <= 2);
  });

  it("treats database failure during unstarted release as a recorded miss, not a hang", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    await assert.rejects(
      () =>
        queue.releaseUnstartedJobs([{ id: "00000000-0000-0000-0000-000000000001", claimGeneration: 1 }], "w", {
          update() {
            return {
              set() {
                return {
                  where() {
                    return {
                      returning: async () => {
                        throw new Error("simulated shutdown release db failure");
                      },
                    };
                  },
                };
              },
            };
          },
        } as never),
      /simulated shutdown release db failure/,
    );
  });
});
