import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, before, after } from "node:test";
import { classifyGraphHttpStatus, parseRetryAfterMs, graphFetch } from "./microsoftGraph/http.ts";
import {
  resetGraphSimulator,
  simulatedGraphSend,
  simulateGraphNotification,
  simulateDeltaFetch,
  simulateCreateSubscription,
  simulateRenewSubscription,
  expireSimulatedSubscription,
  graphSimulatorState,
  unmissGraphNotification,
  simulatedGraphSendCount,
  reconcileSimulatedGraphSend,
} from "./microsoftGraph/simulator.ts";
import { isRetryableTxError, withSerializableRetry, armTxRetryFailures } from "./txRetry.ts";
import { maybeInjectSubmitFailure, submitFailAt } from "./submitFailInject.ts";

describe("failure-injection matrix — Graph simulator", () => {
  before(() => {
    process.env.CRM_GRAPH_SIMULATOR = "true";
  });
  after(() => {
    resetGraphSimulator();
  });

  it("token timeout / 401 / 403 / 404 / 409 / 5xx / connection reset", async () => {
    const cases: Array<{ outcome: typeof graphSimulatorState.nextOutcome; status?: number; match: RegExp }> = [
      { outcome: "token_timeout", status: 504, match: /token acquisition timeout/ },
      { outcome: "401", status: 401, match: /401/ },
      { outcome: "403", status: 403, match: /403/ },
      { outcome: "404", status: 404, match: /404/ },
      { outcome: "409", status: 409, match: /409/ },
      { outcome: "5xx", status: 500, match: /500/ },
      { outcome: "reset", match: /ECONNRESET/ },
    ];
    for (const c of cases) {
      resetGraphSimulator();
      graphSimulatorState.nextOutcome = c.outcome;
      await assert.rejects(
        () => simulatedGraphSend({ idempotencyKey: `k-${c.outcome}`, to: "a@b.com", subject: "x" }),
        (err: unknown) => {
          assert.match(String((err as Error).message), c.match);
          if (c.status) assert.equal((err as { status?: number }).status, c.status);
          return true;
        },
      );
    }
  });

  it("429 Retry-After seconds and HTTP-date", async () => {
    resetGraphSimulator();
    graphSimulatorState.nextOutcome = "429_seconds";
    graphSimulatorState.nextRetryAfter = "3";
    await assert.rejects(
      () => simulatedGraphSend({ idempotencyKey: "ra-s", to: "a@b.com", subject: "x" }),
      (err: unknown) => {
        assert.equal((err as { status: number }).status, 429);
        assert.equal((err as { headers?: Record<string, string> }).headers?.["Retry-After"], "3");
        assert.equal(parseRetryAfterMs("3"), 3000);
        return true;
      },
    );
    resetGraphSimulator();
    const future = new Date(Date.now() + 4000).toUTCString();
    graphSimulatorState.nextOutcome = "429_http_date";
    graphSimulatorState.nextRetryAfter = future;
    await assert.rejects(
      () => simulatedGraphSend({ idempotencyKey: "ra-d", to: "a@b.com", subject: "x" }),
      (err: unknown) => {
        assert.equal((err as { status: number }).status, 429);
        const hdr = (err as { headers?: Record<string, string> }).headers?.["Retry-After"] ?? "";
        assert.ok((parseRetryAfterMs(hdr) ?? -1) >= 0);
        return true;
      },
    );
  });

  it("accepted but response lost reconciles without duplicate send", async () => {
    resetGraphSimulator();
    graphSimulatorState.nextOutcome = "timeout_after_accept";
    await assert.rejects(() =>
      simulatedGraphSend({ idempotencyKey: "lost-resp", to: "a@b.com", subject: "x" }),
    );
    assert.equal(simulatedGraphSendCount("lost-resp"), 1);
    const recon = reconcileSimulatedGraphSend("lost-resp");
    assert.equal(recon?.status, "accepted");
    assert.ok(recon?.providerMessageId);
    // retry with accepted outcome returns same provider id (idempotent)
    graphSimulatorState.nextOutcome = "accepted";
    const again = await simulatedGraphSend({ idempotencyKey: "lost-resp", to: "a@b.com", subject: "x" });
    assert.equal(again.providerMessageId, recon!.providerMessageId);
    assert.equal(simulatedGraphSendCount("lost-resp"), 2);
  });

  it("duplicate / missed / invalid delta / subscription expiry / renew collision", async () => {
    resetGraphSimulator();
    const first = simulateGraphNotification("evt-1");
    assert.equal(first.accepted, true);
    const dup = simulateGraphNotification("evt-1");
    assert.equal(dup.duplicate, true);
    graphSimulatorState.missedNotificationIds.add("evt-miss");
    const missed = simulateGraphNotification("evt-miss");
    assert.equal(missed.missed, true);
    unmissGraphNotification("evt-miss");
    assert.equal(simulateGraphNotification("evt-miss").accepted, true);

    assert.equal(simulateDeltaFetch("invalid").ok, false);
    graphSimulatorState.invalidDeltaTokens.add("tok-bad");
    assert.equal(simulateDeltaFetch("tok-bad").reason, "invalid_delta_token");
    assert.equal(simulateDeltaFetch("tok-good").ok, true);

    const sub = simulateCreateSubscription("ops@example.com");
    expireSimulatedSubscription(sub.id);
    assert.throws(() => simulateRenewSubscription(sub.id), /expired|not found/);

    const live = simulateCreateSubscription("ops2@example.com");
    graphSimulatorState.subscriptionRenewCollision = true;
    const collision = simulateRenewSubscription(live.id);
    assert.equal(collision.collision, true);
  });

  it("classifies statuses and honours Retry-After date in graphFetch", async () => {
    assert.equal(classifyGraphHttpStatus(401), "auth");
    assert.equal(classifyGraphHttpStatus(403), "auth");
    assert.equal(classifyGraphHttpStatus(404), "permanent");
    assert.equal(classifyGraphHttpStatus(409), "transient");
    assert.equal(classifyGraphHttpStatus(429), "throttle");
    let attempts = 0;
    const future = new Date(Date.now() + 5).toUTCString();
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("throttle", { status: 429, headers: { "Retry-After": future } });
      }
      return new Response("ok", { status: 200 });
    };
    const res = await graphFetch("https://graph.microsoft.com/v1.0/me", {}, fetchImpl as typeof fetch, {
      maxAttempts: 3,
      baseDelayMs: 1,
    });
    assert.equal(res.status, 200);
    assert.equal(attempts, 2);
  });
});

describe("failure-injection matrix — tx retry / submit hooks", () => {
  it("retries injected serialization failures then succeeds", async () => {
    process.env.NODE_ENV = "test";
    let attempts = 0;
    const value = await withSerializableRetry(async () => {
      attempts += 1;
      if (attempts <= 2) {
        throw Object.assign(new Error("injected serialization_failure"), { code: "40001" });
      }
      return "ok";
    }, { baseDelayMs: 1 });
    assert.equal(value, "ok");
    assert.equal(attempts, 3);

    armTxRetryFailures(2);
    let seen = 0;
    const again = await withSerializableRetry(async () => {
      seen += 1;
      return "armed-ok";
    }, { baseDelayMs: 1 });
    assert.equal(again, "armed-ok");
    // arm injects before run(), so run executes once after two pre-run failures
    assert.equal(seen, 1);
  });

  it("classifies 40001/40P01 as retryable", () => {
    assert.equal(isRetryableTxError({ code: "40001" }), true);
    assert.equal(isRetryableTxError({ code: "40P01" }), true);
    assert.equal(isRetryableTxError({ code: "23505" }), false);
  });

  it("submit fail-at hooks throw at configured stages", () => {
    process.env.NODE_ENV = "test";
    for (const stage of ["before_tx", "during_tx", "after_commit", "pool_exhaust", "db_timeout", "rate_limit_tx"] as const) {
      process.env.CRM_TEST_SUBMIT_FAIL_AT = stage;
      assert.equal(submitFailAt(), stage);
      assert.throws(() => maybeInjectSubmitFailure(stage));
    }
    delete process.env.CRM_TEST_SUBMIT_FAIL_AT;
    assert.equal(submitFailAt(), null);
  });
});
