/**
 * Retry PostgreSQL serialization / deadlock failures inside a bounded loop.
 * Used by contact submit and other contended writes.
 *
 * Test-only injection: call `armTxRetryFailures(n)` (never via production paths)
 * to force N synthetic 40001 failures before success. Env CRM_TEST_TX_RETRY_FAIL_COUNT
 * is also honoured when NODE_ENV !== production (single-process tests only).
 */

let armedFailures = 0;

export function armTxRetryFailures(count: number): void {
  armedFailures = Math.max(0, Math.floor(count));
}

export function isRetryableTxError(err: unknown): boolean {
  const code =
    typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
  if (code === "40001" || code === "40P01") return true;
  const constraint =
    typeof err === "object" && err && "constraint" in err
      ? String((err as { constraint: unknown }).constraint)
      : "";
  // Year-counter lag after restore / rolled-back races — safe to retry after counter resync.
  if (code === "23505" && constraint.includes("reference")) return true;
  return false;
}

export function injectTxRetryFailureIfConfigured(): void {
  if (process.env.NODE_ENV === "production") return;
  if (armedFailures > 0) {
    armedFailures -= 1;
    throw Object.assign(new Error("injected serialization_failure"), { code: "40001" });
  }
  const remaining = Number(process.env.CRM_TEST_TX_RETRY_FAIL_COUNT ?? "0");
  if (!Number.isFinite(remaining) || remaining <= 0) return;
  process.env.CRM_TEST_TX_RETRY_FAIL_COUNT = String(remaining - 1);
  throw Object.assign(new Error("injected serialization_failure"), { code: "40001" });
}

export async function withSerializableRetry<T>(
  run: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number; onRetry?: (err: unknown, attempt: number) => Promise<void> | void },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseDelayMs = opts?.baseDelayMs ?? 15;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      injectTxRetryFailureIfConfigured();
      return await run();
    } catch (err) {
      if (!isRetryableTxError(err) || attempt >= maxAttempts) throw err;
      if (opts?.onRetry) await opts.onRetry(err, attempt);
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * baseDelayMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
