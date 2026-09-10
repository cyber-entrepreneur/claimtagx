import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertInquiryAccess,
  decodeInquiryCursor,
  encodeInquiryCursor,
} from "./objectAuth.ts";
import type { CrmStaff } from "@workspace/db";

function staff(partial: Partial<CrmStaff> & Pick<CrmStaff, "id" | "role">): CrmStaff {
  return {
    email: "t@example.com",
    emailNormalized: "t@example.com",
    name: "T",
    status: "active",
    permissions: [],
    ...partial,
  } as CrmStaff;
}

describe("objectAuth helpers", () => {
  it("allows admin mutate on foreign assignment and denies sales", () => {
    const inquiry = { assignedStaffId: "other" };
    assert.doesNotThrow(() => assertInquiryAccess(staff({ id: "a1", role: "admin" }), inquiry, "mutate"));
    assert.throws(
      () => assertInquiryAccess(staff({ id: "s1", role: "sales" }), inquiry, "mutate"),
      (err: Error & { status?: number; code?: string }) => err.status === 403 && err.code === "OBJECT_AUTH_DENIED",
    );
  });

  it("denies agents viewing another team's records", () => {
    const agent = staff({ id: "ag1", role: "agent", teamId: "team-a" });
    assert.throws(() =>
      assertInquiryAccess(agent, { assignedStaffId: "other", assignedTeamId: "team-b" }, "view"),
    );
    assert.doesNotThrow(() =>
      assertInquiryAccess(agent, { assignedStaffId: "other", assignedTeamId: "team-a" }, "view"),
    );
  });

  it("round-trips inquiry keyset cursors", () => {
    const createdAt = new Date("2026-09-02T10:00:00.000Z");
    const encoded = encodeInquiryCursor({ createdAt, id: "11111111-1111-1111-1111-111111111111" });
    const decoded = decodeInquiryCursor(encoded);
    assert.ok(decoded);
    assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
    assert.equal(decoded.id, "11111111-1111-1111-1111-111111111111");
  });
});
