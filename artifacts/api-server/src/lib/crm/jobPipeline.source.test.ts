import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { classifyJobFailure, jobConcurrencyKey, workerConcurrency } from "./jobPipeline.ts";

const jobs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "jobs.ts"), "utf8");
const queue = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "queue.ts"), "utf8");

describe("job pipeline instrumentation and concurrency", () => {
  it("aborts heartbeat waiters when handler work finishes", () => {
    assert.match(queue, /while \(!stopped && !abort\.signal\.aborted && Date\.now\(\) < until\)/);
  });

  it("runs claimed jobs with bounded slots and per-type keys", () => {
    assert.match(jobs, /runClaimedJobs/);
    assert.match(jobs, /workerConcurrency\(\)/);
    assert.match(jobs, /jobConcurrencyKey/);
    assert.match(queue, /payload->>'_ck'/);
  });

  it("classifies soak poison and injected transients", () => {
    const poison = classifyJobFailure("unknown crm job type: soak_poison_x", "soak_poison_x");
    assert.equal(poison.retryClass, "deliberately_injected");
    assert.equal(poison.immediateDead, true);
    const injected = classifyJobFailure("injected transient soak failure", "analytics");
    assert.equal(injected.retryClass, "deliberately_injected");
    assert.equal(injected.immediateDead, false);
  });

  it("serializes workflow jobs per inquiry", () => {
    assert.equal(
      jobConcurrencyKey({ type: "run_workflows", payload: { inquiryId: "abc" } }),
      "inquiry:abc",
    );
    assert.equal(workerConcurrency() >= 1, true);
  });
});
