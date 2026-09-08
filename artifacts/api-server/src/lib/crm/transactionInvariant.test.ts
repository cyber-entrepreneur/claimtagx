import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Models the submitInquiry invariant without a live Postgres:
 * inquiry rows and outbox jobs are appended to the same buffer; a thrown error
 * discards the buffer (rollback) so neither side is visible.
 */
function atomicSubmit(failAfterInquiry: boolean) {
  const buffer: { inquiries: string[]; jobs: string[] } = { inquiries: [], jobs: [] };
  try {
    buffer.inquiries.push("inq-1");
    if (failAfterInquiry) throw new Error("constraint");
    buffer.jobs.push("run_workflows");
    return { committed: buffer };
  } catch {
    return { committed: { inquiries: [] as string[], jobs: [] as string[] } };
  }
}

describe("transactional outbox invariant", () => {
  it("commits inquiry and jobs together", () => {
    const { committed } = atomicSubmit(false);
    assert.deepEqual(committed.inquiries, ["inq-1"]);
    assert.deepEqual(committed.jobs, ["run_workflows"]);
  });

  it("rolls back jobs when the inquiry write fails", () => {
    const { committed } = atomicSubmit(true);
    assert.deepEqual(committed.inquiries, []);
    assert.deepEqual(committed.jobs, []);
  });
});
