import { describe, it } from "node:test";
import assert from "node:assert/strict";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("heartbeat tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("cancellable heartbeat statement timeout", () => {
  it("cancels a slow query via database statement_timeout", async () => {
    requireIsolatedDb();
    const { runCancellableStatement } = await import("./queue.ts");
    const started = Date.now();
    const result = await runCancellableStatement({
      timeoutMs: 80,
      text: "SELECT pg_sleep(5)",
    });
    assert.equal(result.cancelled, true);
    assert.ok(Date.now() - started < 4000);
  });

  it("does not renew a lease when the heartbeat statement times out", async () => {
    requireIsolatedDb();
    const { db, crmJobsTable } = await import("@workspace/db");
    const { heartbeatJobOnDedicatedConnection, runCancellableStatement } = await import("./queue.ts");
    const { eq, sql } = await import("drizzle-orm");
    const [inserted] = await db
      .insert(crmJobsTable)
      .values({ type: `hb_${Date.now()}`, payload: {}, status: "pending", runAt: new Date() })
      .returning();
    assert.ok(inserted);
    const [job] = await db
      .update(crmJobsTable)
      .set({
        status: "running",
        lockedBy: "hb-owner",
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
        attempts: sql`${crmJobsTable.attempts} + 1`,
      })
      .where(eq(crmJobsTable.id, inserted.id))
      .returning();
    assert.ok(job);
    const before = await db.select().from(crmJobsTable).where(eq(crmJobsTable.id, job.id));
    assert.equal(before[0]?.lockedBy, "hb-owner");
    const cancelled = await runCancellableStatement({
      timeoutMs: 50,
      text: "SELECT pg_sleep(8)",
    });
    assert.equal(cancelled.cancelled, true);
    const renewed = await heartbeatJobOnDedicatedConnection({
      jobId: job.id,
      workerId: "hb-owner",
      claimGeneration: job.claimGeneration,
      queryTimeoutMs: 2000,
    });
    assert.equal(renewed, true);
  });
});
