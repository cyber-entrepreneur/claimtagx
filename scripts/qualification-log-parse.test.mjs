import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePlaywrightQualificationLog, parseProjectChunk } from "./lib/qualificationLogParse.mjs";

const fixture = `QUAL retries=0 workers=1
ISOLATED_DB name=ctx_e2e_deadbeef runId=deadbeef
=== PROJECT firefox-320 (firefox) ===
Running 5 tests using 1 worker
  ok 1 [firefox-320] e2e/contact.spec.ts:1 a
  ok 2 [firefox-320] e2e/contact.spec.ts:2 b
  ok 3 [firefox-320] e2e/contact.spec.ts:3 c
  ok 4 [firefox-320] e2e/contact.spec.ts:4 d
  ok 5 [firefox-320] e2e/contact.spec.ts:5 e

  5 passed (11.0s)
=== PROJECT firefox-390 (firefox) ===
Running 5 tests using 1 worker
  ok 1 [firefox-390] e2e/contact.spec.ts:1 a
  ok 2 [firefox-390] e2e/contact.spec.ts:2 b
  ok 3 [firefox-390] e2e/contact.spec.ts:3 c
  ok 4 [firefox-390] e2e/contact.spec.ts:4 d
  ok 5 [firefox-390] e2e/contact.spec.ts:5 e

  5 passed (12.6s)
ALL_OK firefox first-attempt retries=0 wave=A1
`;

const mixed = `=== PROJECT webkit-1440 (webkit) ===
Running 8 tests using 1 worker
  ok 1 [webkit-1440] t1
  ok 2 [webkit-1440] t2
  x 3 [webkit-1440] t3
  - 4 [webkit-1440] t4

  2 passed (1.0s)
  1 failed
  1 skipped
`;

describe("qualification multi-project log parser", () => {
  it("sums every viewport instead of the last N passed line", () => {
    const parsed = parsePlaywrightQualificationLog(fixture);
    assert.equal(parsed.projects.length, 2);
    assert.equal(parsed.projects[0].passed, 5);
    assert.equal(parsed.projects[1].passed, 5);
    assert.equal(parsed.totals.passed, 10);
    assert.equal(parsed.totals.announced, 10);
    assert.equal(parsed.lastPassedLineOnly, 5);
    assert.equal(parsed.lastLineUndercounts, true);
    assert.equal(parsed.isolatedDb, "ctx_e2e_deadbeef");
  });

  it("records failed, skipped, and did-not-run against announced discovery", () => {
    const p = parseProjectChunk(mixed.replace("=== PROJECT ", ""));
    assert.equal(p.announced, 8);
    assert.equal(p.passed, 2);
    assert.equal(p.failed, 1);
    assert.equal(p.skipped, 1);
    assert.equal(p.didNotRun, 4);
  });
});
