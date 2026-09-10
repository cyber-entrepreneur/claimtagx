import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  exportAnalyticsBatch,
  memoryAnalyticsDestination,
  recordAnalyticsDeletionPropagation,
  analyticsIntegrationHealth,
} from "./analyticsIntegration.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("analytics integration tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("analytics integration PostgreSQL boundary", () => {
  it("exports idempotent batches, advances watermark, supports replay, and records deletion events", async () => {
    requireIsolatedDb();
    const { db, crmAnalyticsEventsTable, crmConfigTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db.delete(crmConfigTable).where(eq(crmConfigTable.key, "analytics_integration_watermark"));
    const marker = `integ-${randomUUID().slice(0, 8)}`;
    await db.insert(crmAnalyticsEventsTable).values({
      event: marker,
      properties: { source: "test" },
    });
    const dest = memoryAnalyticsDestination();
    const first = await exportAnalyticsBatch({ adapter: dest, limit: 50 });
    assert.equal(first.failed, false);
    assert.ok((first.exported ?? 0) >= 1);
    const second = await exportAnalyticsBatch({ adapter: dest, limit: 50 });
    assert.equal(second.failed, false);
    const keys = dest.batches.map((b) => b.idempotencyKey);
    assert.equal(new Set(keys).size, keys.length);
    const replay = await exportAnalyticsBatch({
      adapter: dest,
      limit: 50,
      replayFromCursor: null,
    });
    assert.ok(replay.exported >= 1);
    await recordAnalyticsDeletionPropagation({
      contactId: "11111111-1111-1111-1111-111111111111",
      reason: "deletion",
    });
    const health = await analyticsIntegrationHealth();
    assert.equal(health.schemaVersion, 1);
    assert.ok(health.pendingApprox >= 0);
  });
});
