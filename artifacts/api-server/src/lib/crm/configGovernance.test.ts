import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertConfigSchema,
  assertEmergencyBypass,
  assertNoInterveningPublish,
  assertOptimisticConcurrency,
  auditPayloadForTransition,
  buildRollbackSuccessor,
  canApprove,
  emergencyBypassAllowed,
  nextConfigChangeStatus,
  permissionForEvent,
} from "./configLifecycle.ts";
import { ConfigLedger } from "./configLedger.ts";

describe("change-governance bypass prevention", () => {
  it("does not apply live config until publish of an approved change", () => {
    const ledger = new ConfigLedger();
    ledger.live.set("sla_policy:p1", { version: 1, value: { firstResponseMinutes: 60 } });
    const draft = ledger.draft({
      id: "c1",
      entityType: "sla_policy",
      entityId: "p1",
      authorStaffId: "author-1",
      afterValue: { firstResponseMinutes: 30 },
    });
    assert.equal(ledger.live.get("sla_policy:p1")?.value.firstResponseMinutes, 60);
    ledger.transition(draft.id, "submit_review", { actorStaffId: "author-1", actorRole: "admin" });
    assert.throws(() =>
      ledger.transition(draft.id, "publish", {
        actorStaffId: "admin-2",
        actorRole: "admin",
        permissions: ["config.publish"],
      }),
    );
    assert.equal(ledger.live.get("sla_policy:p1")?.value.firstResponseMinutes, 60);
  });

  it("rejects self-approval even for owners", () => {
    assert.equal(
      canApprove({ status: "in_review", authorStaffId: "owner-1" }, { actorStaffId: "owner-1", actorRole: "owner" }),
      false,
    );
    assert.throws(
      () =>
        nextConfigChangeStatus(
          { status: "in_review", authorStaffId: "owner-1" },
          "approve",
          { actorStaffId: "owner-1", actorRole: "owner" },
        ),
      /different reviewer/,
    );
  });

  it("allows a second actor with review permission to approve", () => {
    assert.equal(
      nextConfigChangeStatus(
        { status: "in_review", authorStaffId: "author-1" },
        "approve",
        { actorStaffId: "reviewer-2", actorRole: "admin", permissions: ["config.review"] },
      ),
      "approved",
    );
  });

  it("keeps published values immutable by writing a new rollback successor version", () => {
    const published = buildRollbackSuccessor({
      publishedChangeId: "c-pub",
      entityType: "taxonomy",
      entityId: "t1",
      restoredValue: { label: "old" },
      previousPublishedValue: { label: "new" },
      actorStaffId: "admin-2",
      correlationId: "corr-1",
      nextVersion: 3,
    });
    assert.equal(published.version, 3);
    assert.equal(published.rollbackOfId, "c-pub");
    assert.equal(published.afterValue.label, "old");
  });

  it("rolls back by inserting a new governed version, not rewriting the original row", () => {
    const ledger = new ConfigLedger();
    ledger.live.set("workflow:w1", { version: 1, value: { name: "A" } });
    const draft = ledger.draft({
      id: "c2",
      entityType: "workflow",
      entityId: "w1",
      authorStaffId: "a",
      afterValue: { name: "B" },
    });
    ledger.transition(draft.id, "submit_review", { actorStaffId: "a", actorRole: "admin" });
    ledger.transition(draft.id, "approve", { actorStaffId: "b", actorRole: "admin", permissions: ["config.review"] });
    ledger.transition(draft.id, "publish", { actorStaffId: "b", actorRole: "admin", permissions: ["config.publish"] });
    const original = ledger.changes.find((c) => c.id === "c2")!;
    const beforeRollback = original.afterValue.name;
    ledger.transition(draft.id, "rollback", { actorStaffId: "b", actorRole: "admin", permissions: ["config.publish"] });
    const successor = ledger.changes.find((c) => c.rollbackOfId === "c2");
    assert.ok(successor);
    assert.equal(original.afterValue.name, beforeRollback);
    assert.equal(successor?.afterValue.name, "A");
    assert.equal(ledger.live.get("workflow:w1")?.version, successor?.version);
  });

  it("does not mutate live config when apply fails (atomic publication)", () => {
    const ledger = new ConfigLedger();
    ledger.live.set("macro:m1", { version: 1, value: { name: "keep" } });
    const draft = ledger.draft({
      id: "c3",
      entityType: "macro",
      entityId: "m1",
      authorStaffId: "a",
      afterValue: { name: "drop" },
    });
    ledger.transition(draft.id, "submit_review", { actorStaffId: "a", actorRole: "admin" });
    ledger.transition(draft.id, "approve", { actorStaffId: "b", actorRole: "admin", permissions: ["config.review"] });
    ledger.failNextApply = true;
    assert.throws(() =>
      ledger.transition(draft.id, "publish", {
        actorStaffId: "b",
        actorRole: "admin",
        permissions: ["config.publish"],
      }),
    );
    assert.equal(ledger.live.get("macro:m1")?.value.name, "keep");
    assert.equal(ledger.changes.find((c) => c.id === "c3")?.status, "approved");
  });

  it("keeps emergency bypass disabled by default and distinct from review/publish", () => {
    assert.equal(emergencyBypassAllowed({}), false);
    assert.equal(permissionForEvent("approve"), "config.review");
    assert.equal(permissionForEvent("publish"), "config.publish");
    assert.equal(permissionForEvent("submit_review"), "config.propose");
    assert.throws(() =>
      assertEmergencyBypass(
        { actorStaffId: "o", actorRole: "owner", emergencyBypass: true, emergencyReason: "short" },
        {},
      ),
    );
  });

  it("rejects stale expectedUpdatedAt", () => {
    assert.throws(
      () => assertOptimisticConcurrency("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"),
      /someone else/,
    );
  });
});

describe("emergency bypass proofs", () => {
  it("is disabled in production unless CRM_CONFIG_EMERGENCY_BYPASS=true", () => {
    assert.equal(emergencyBypassAllowed({ NODE_ENV: "production" }), false);
    assert.equal(
      emergencyBypassAllowed({ NODE_ENV: "production", CRM_CONFIG_EMERGENCY_BYPASS: "true" }),
      true,
    );
  });

  it("requires the dedicated permission even for owners", () => {
    assert.throws(
      () =>
        assertEmergencyBypass(
          {
            actorStaffId: "o",
            actorRole: "owner",
            emergencyBypass: true,
            emergencyReason: "production outage restore",
            permissions: [],
          },
          { CRM_CONFIG_EMERGENCY_BYPASS: "true" },
        ),
      /config.emergency_bypass/,
    );
  });

  it("requires a qualifying reason", () => {
    assert.throws(
      () =>
        assertEmergencyBypass(
          {
            actorStaffId: "o",
            actorRole: "owner",
            emergencyBypass: true,
            emergencyReason: "too-short",
            permissions: ["config.emergency_bypass"],
          },
          { CRM_CONFIG_EMERGENCY_BYPASS: "true" },
        ),
      /12 characters/,
    );
  });

  it("records a high-severity audit payload", () => {
    const payload = auditPayloadForTransition({
      action: "emergency_publish",
      actorStaffId: "o",
      changeId: "c1",
      fromStatus: "draft",
      toStatus: "published",
      beforeVersion: 1,
      afterVersion: 2,
      rationale: "production outage restore",
      emergency: true,
    });
    assert.equal(payload.severity, "high");
    assert.equal(payload.action, "emergency_publish");
  });

  it("cannot silently overwrite an intervening published version", () => {
    assert.throws(
      () => assertNoInterveningPublish({ expectedLiveVersion: 2, currentLiveVersion: 3 }),
      /intervening published version/,
    );
  });

  it("cannot bypass schema validation", () => {
    assert.throws(
      () => assertConfigSchema("sla_policy", { firstResponseMinutes: 0, timeZone: "UTC" }),
      /greater than 0/,
    );
    assert.doesNotThrow(() =>
      assertConfigSchema("sla_policy", { firstResponseMinutes: 15, timeZone: "UTC" }),
    );
  });
});
