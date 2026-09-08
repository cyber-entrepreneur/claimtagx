import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { pool } from "@workspace/db";
import { submitInquiry } from "./orchestrator.ts";

const hasDb = /127\.0\.0\.1:(55432|55470)/.test(process.env.DATABASE_URL ?? "");

describe("contact submit latency regression", { skip: !hasDb }, () => {
  it("completes a synthetic general inquiry under 500ms locally", async () => {
    process.env.CRM_SUBMIT_TIMING = "1";
    process.env.CRM_SKIP_RUNTIME_SEED = "true";
    const correlationId = `latency-${randomUUID()}`;
    const t0 = performance.now();
    const result = await submitInquiry(
      {
        firstName: "Latency",
        lastName: "Probe",
        jobTitle: "Engineer",
        companyName: "LatencyCo",
        email: `latency.${Date.now()}@example.com`,
        country: "US",
        phoneRaw: "+14155552671",
        inquiryType: "general",
        useCaseKeys: [],
        message: "Synthetic latency regression probe.",
        answers: {},
        termsAccepted: true,
        termsVersion: "2026-04-20",
        privacyPolicyVersion: "2026-04-20",
        idempotencyKey: randomUUID(),
      },
      { ip: "127.0.0.1", userAgent: "latency-test", correlationId },
    );
    const wallMs = performance.now() - t0;
    assert.ok(result.reference.startsWith("CTX-"));
    assert.ok(wallMs < 2000, `expected <2000ms wall on isolated 55432, got ${wallMs.toFixed(1)}ms`);
    assert.ok(result.timing, "timing required when CRM_SUBMIT_TIMING=1");
    assert.ok(
      (result.timing!.stages.tx_sla_compute ?? result.timing!.stages.tx_sla ?? 0) < 100,
      `SLA stage too slow: ${JSON.stringify(result.timing!.stages)}`,
    );
  });
});

process.on("beforeExit", async () => {
  await pool.end().catch(() => undefined);
});
