/**
 * Test-only contact-submit failure injection.
 * Never active when NODE_ENV=production. Controlled exclusively by CRM_TEST_SUBMIT_FAIL_AT.
 *
 * Values:
 * - before_tx: abort before opening the system-of-record transaction
 * - during_tx: abort mid-transaction (after reference allocation) to force rollback
 * - after_commit: abort immediately after commit (inquiry persists; client sees failure)
 * - rate_limit_tx: force rate-limit helper to throw (caller maps to 503)
 * - pool_exhaust: throw a pool-timeout shaped error
 * - db_timeout: throw a statement_timeout shaped error
 */

export type SubmitFailAt =
  | "before_tx"
  | "during_tx"
  | "after_commit"
  | "rate_limit_tx"
  | "pool_exhaust"
  | "db_timeout";

export function submitFailAt(): SubmitFailAt | null {
  if (process.env.NODE_ENV === "production") return null;
  const v = process.env.CRM_TEST_SUBMIT_FAIL_AT;
  if (
    v === "before_tx" ||
    v === "during_tx" ||
    v === "after_commit" ||
    v === "rate_limit_tx" ||
    v === "pool_exhaust" ||
    v === "db_timeout"
  ) {
    return v;
  }
  return null;
}

export function maybeInjectSubmitFailure(stage: SubmitFailAt): void {
  if (submitFailAt() !== stage) return;
  if (stage === "pool_exhaust") {
    throw Object.assign(new Error("timeout exceeded when trying to connect"), {
      code: "CONNECTION_POOL_TIMEOUT",
      status: 503,
    });
  }
  if (stage === "db_timeout") {
    throw Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
      status: 503,
    });
  }
  if (stage === "rate_limit_tx") {
    throw Object.assign(new Error("injected rate-limit transaction failure"), {
      code: "40P01",
      status: 503,
    });
  }
  throw Object.assign(new Error(`injected submit failure at ${stage}`), {
    code: "CRM_TEST_SUBMIT_FAIL",
    status: stage === "after_commit" ? 500 : 503,
    retryable: stage !== "during_tx",
  });
}
