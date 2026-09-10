import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorkerId } from "./workerIdentity.ts";
import { hasPermission, ROLE_PERMISSIONS } from "./rbac.ts";

describe("crm worker identity", () => {
  it("creates unique worker ids", () => {
    const a = createWorkerId();
    const b = createWorkerId();
    assert.notEqual(a, b);
    assert.match(a, /:\d+:/);
  });
});

describe("crm rbac", () => {
  it("owner has template manage permission", () => {
    assert.equal(hasPermission(ROLE_PERMISSIONS.owner, "templates.manage"), true);
  });

  it("analyst cannot reply", () => {
    assert.equal(hasPermission(ROLE_PERMISSIONS.analyst, "inquiries.reply"), false);
  });

  it("sales can view and reply", () => {
    assert.equal(hasPermission(ROLE_PERMISSIONS.sales, "inquiries.view"), true);
    assert.equal(hasPermission(ROLE_PERMISSIONS.sales, "inquiries.reply"), true);
  });
});
