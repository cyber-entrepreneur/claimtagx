import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLATFORM_PERMISSIONS, ROLE_PERMISSIONS, hasPermission } from "./rbac.ts";

/** Every mutation-facing permission must be granted to owner and denied to analyst unless view/analytics. */
const MUTATION_PERMISSIONS = PLATFORM_PERMISSIONS.filter(
  (p) =>
    !p.endsWith(".view") &&
    p !== "analytics.view" &&
    p !== "inquiries.lead_score.view",
);

describe("permission matrix", () => {
  it("owner has every platform permission", () => {
    for (const p of PLATFORM_PERMISSIONS) {
      assert.equal(hasPermission(ROLE_PERMISSIONS.owner, p), true, p);
    }
  });

  it("analyst cannot perform mutations", () => {
    for (const p of MUTATION_PERMISSIONS) {
      assert.equal(hasPermission(ROLE_PERMISSIONS.analyst, p), false, p);
    }
  });

  it("sales can reply but cannot manage workflows", () => {
    assert.equal(hasPermission(ROLE_PERMISSIONS.sales, "inquiries.reply"), true);
    assert.equal(hasPermission(ROLE_PERMISSIONS.sales, "workflows.manage"), false);
    assert.equal(hasPermission(ROLE_PERMISSIONS.sales, "config.manage"), false);
  });

  it("operator cannot override qualification", () => {
    assert.equal(
      hasPermission(ROLE_PERMISSIONS.operator, "inquiries.qualification.override"),
      false,
    );
  });
});
