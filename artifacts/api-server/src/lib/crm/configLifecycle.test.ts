import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionsForStatus,
  dryRunForEntity,
  dryRunQualificationThresholds,
  nextConfigChangeStatus,
  summarizeImpact,
} from "./configLifecycle.ts";

describe("config change lifecycle", () => {
  const change = { status: "draft" as const, authorStaffId: "author-1" };

  it("moves draft to in_review", () => {
    assert.equal(
      nextConfigChangeStatus(change, "submit_review", { actorStaffId: "author-1", actorRole: "admin" }),
      "in_review",
    );
  });

  it("rejects self-approval for admins", () => {
    assert.throws(
      () =>
        nextConfigChangeStatus(
          { status: "in_review", authorStaffId: "author-1" },
          "approve",
          { actorStaffId: "author-1", actorRole: "admin" },
        ),
      /different reviewer/,
    );
  });

  it("allows a second admin to approve", () => {
    assert.equal(
      nextConfigChangeStatus(
        { status: "in_review", authorStaffId: "author-1" },
        "approve",
        { actorStaffId: "admin-2", actorRole: "admin" },
      ),
      "approved",
    );
  });

  it("rejects owner self-approval (dual control)", () => {
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

  it("cannot publish from draft", () => {
    assert.throws(
      () => nextConfigChangeStatus(change, "publish", { actorStaffId: "admin-2", actorRole: "admin" }),
      /Cannot publish/,
    );
  });

  it("summarizes field diffs", () => {
    assert.match(
      summarizeImpact({
        entityType: "qualification_model",
        before: { HIGH_PRIORITY: 90 },
        after: { HIGH_PRIORITY: 85 },
      }),
      /HIGH_PRIORITY/,
    );
  });

  it("dry-runs invalid threshold order", () => {
    const warnings = dryRunQualificationThresholds({
      HIGH_PRIORITY: 50,
      SALES_QUALIFIED: 70,
      MARKETING_QUALIFIED: 40,
    });
    assert.ok(warnings.length > 0);
  });

  it("dry-runs nested qualification afterValue and invalid time zones", () => {
    const nested = dryRunForEntity("qualification_model", {
      thresholds: { HIGH_PRIORITY: 50, SALES_QUALIFIED: 70, MARKETING_QUALIFIED: 40 },
    });
    assert.ok(nested.length > 0);
    const sla = dryRunForEntity("sla_policy", { firstResponseMinutes: 30, timeZone: "Not/AZone" });
    assert.ok(sla.some((w) => /IANA/i.test(w)));
    assert.ok(actionsForStatus("draft").includes("submit_review"));
  });
});
