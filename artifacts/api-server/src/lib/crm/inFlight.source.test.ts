import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const jobs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "jobs.ts"), "utf8");

describe("worker inFlight overlap protection", () => {
  it("skips a new tick while a previous batch is still in flight", () => {
    assert.match(jobs, /let inFlightCount = 0/);
    assert.match(jobs, /if \(shuttingDown \|\| inFlightCount > 0\) return;/);
    assert.match(jobs, /inFlightCount \+= 1/);
    assert.match(jobs, /inFlightCount = Math\.max\(0, inFlightCount - 1\)/);
  });
});
