import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertMarketingTransition,
  validateMarketingPublication,
} from "./marketingLifecycle";

describe("marketing CMS lifecycle", () => {
  it("requires reviewer distinct from author on approve", () => {
    assert.throws(
      () =>
        assertMarketingTransition({
          status: "in_review",
          transition: "approve",
          actorStaffId: "author-1",
          authorStaffId: "author-1",
          permissions: ["marketing.review"],
        }),
      (err: Error & { status?: number }) => err.status === 403,
    );
  });

  it("allows publish after approval by a different staff member", () => {
    const next = assertMarketingTransition({
      status: "approved",
      transition: "publish",
      actorStaffId: "publisher-1",
      authorStaffId: "author-1",
      permissions: ["marketing.publish"],
    });
    assert.equal(next, "published");
  });

  it("rejects stale lock version", () => {
    assert.throws(
      () =>
        assertMarketingTransition({
          status: "draft",
          transition: "submit_review",
          actorStaffId: "author-1",
          authorStaffId: "author-1",
          permissions: ["marketing.propose"],
          expectedLockVersion: 2,
          currentLockVersion: 3,
        }),
      (err: Error & { status?: number }) => err.status === 409,
    );
  });

  it("validates SEO and localization completeness before publish", () => {
    const issues = validateMarketingPublication({
      locale: "en",
      title: "Home",
      seoTitle: "",
      seoDescription: "Desc",
      body: { hero: "x" },
      requiredLocales: ["en", "ar"],
      peerLocalesPublished: ["en"],
    });
    assert.ok(issues.includes("seoTitle"));
    assert.ok(issues.includes("missingLocale:ar"));
  });
});
