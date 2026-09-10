import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { pool } from "@workspace/db";
import { submitInquiry } from "./orchestrator.ts";

const hasDb = /127\.0\.0\.1:(55432|55470)/.test(process.env.DATABASE_URL ?? "");

type Sample = {
  wallMs: number;
  slaMs: number;
  waiting: number;
};

async function probeOnce(): Promise<Sample> {
  const correlationId = `latency-${randomUUID()}`;
  const t0 = performance.now();
  const result = await submitInquiry(
    {
      firstName: "Latency",
      lastName: "Probe",
      jobTitle: "Engineer",
      companyName: "LatencyCo",
      email: `latency.${Date.now()}.${randomUUID().slice(0, 8)}@example.com`,
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
  assert.ok(result.timing, "timing required when CRM_SUBMIT_TIMING=1");
  const slaMs = result.timing!.stages.tx_sla_compute ?? result.timing!.stages.tx_sla;
  assert.equal(typeof slaMs, "number", `SLA stage missing: ${JSON.stringify(result.timing!.stages)}`);
  assert.ok(Number.isFinite(slaMs) && slaMs >= 0, `SLA stage invalid: ${slaMs}`);
  return {
    wallMs,
    slaMs: slaMs as number,
    waiting: result.timing!.pool?.waiting ?? 0,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

describe("contact submit latency regression", { skip: !hasDb }, () => {
  it("records SLA stage timing and keeps local wall-clock under bound after warmup", async () => {
    process.env.CRM_SUBMIT_TIMING = "1";
    // Seed once if the verify DB was freshly migrated; then skip reseed for timing samples.
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    process.env.CRM_SKIP_RUNTIME_SEED = "true";

    // Discard cold/JIT + connection checkout.
    await probeOnce();

    const samples: Sample[] = [];
    for (let i = 0; i < 5; i++) {
      samples.push(await probeOnce());
    }

    const walls = samples.map((s) => s.wallMs);
    const slas = samples.map((s) => s.slaMs);
    const wallP50 = median(walls);
    const slaP50 = median(slas);
    const contended = samples.some((s) => s.waiting > 0);

    assert.ok(
      wallP50 < 2000,
      `wall P50 too high on isolated 55432: ${wallP50.toFixed(1)}ms samples=${JSON.stringify(samples)}`,
    );

    // Functional instrumentation: SLA stage must be recorded every run.
    assert.ok(slas.every((v) => Number.isFinite(v)), `SLA stages incomplete: ${JSON.stringify(slas)}`);

    // Local performance regression (not production SLO):
    // - Quiet pool: P50 SLA stage must stay under 100ms (historical intent).
    // - Contended pool (other suite workers): allow up to 500ms absolute ceiling
    //   so shared-run noise is not misclassified as an SLA algorithm regression.
    // Strict mode (CRM_SUBMIT_LATENCY_STRICT=1) always enforces 100ms.
    const strict = process.env.CRM_SUBMIT_LATENCY_STRICT === "1";
    const slaBoundMs = strict || !contended ? 100 : 500;
    assert.ok(
      slaP50 < slaBoundMs,
      `SLA stage P50 ${slaP50.toFixed(1)}ms exceeds ${slaBoundMs}ms ` +
        `(contended=${contended}, strict=${strict}) samples=${JSON.stringify(samples)}`,
    );
  });
});

process.on("beforeExit", async () => {
  await pool.end().catch(() => undefined);
});
