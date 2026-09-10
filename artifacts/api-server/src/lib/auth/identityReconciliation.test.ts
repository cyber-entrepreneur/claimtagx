import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIdentityReconciliationReport } from "./identityReconciliation";

describe("identity reconciliation report", () => {
  it("matches only verified normalized email identifiers across case and whitespace variants", () => {
    const report = buildIdentityReconciliationReport({
      staff: [
        { staffId: "staff-a", email: " Owner@Example.COM " },
        { staffId: "staff-aa", email: "fallback@example.com", emailNormalized: " FALLBACK@Example.COM " },
        { staffId: "staff-b", email: "unverified@example.com" },
        { staffId: "staff-c", email: "missing@example.com" },
        { staffId: "staff-d", email: "linked@example.com", authAccountId: "acct-existing" },
      ],
      identifiers: [
        { accountId: "acct-a", kind: "email", value: " owner@example.com ", verified: true },
        { accountId: "acct-aa", kind: "email", value: "fallback@example.com", verified: true },
        { accountId: "acct-b", kind: "email", value: "unverified@example.com", verified: false },
        { accountId: "acct-phone", kind: "phone", value: "owner@example.com", verified: true },
      ],
    });

    assert.deepEqual(report.unique, [
      { staffId: "staff-a", emailNormalized: "owner@example.com", accountId: "acct-a" },
      { staffId: "staff-aa", emailNormalized: "fallback@example.com", accountId: "acct-aa" },
    ]);
    assert.deepEqual(report.missing, [
      { staffId: "staff-b", emailNormalized: "unverified@example.com", reason: "no_verified_email_identifier" },
      { staffId: "staff-c", emailNormalized: "missing@example.com", reason: "no_verified_email_identifier" },
    ]);
    assert.deepEqual(report.ambiguous, []);
  });

  it("reports ambiguous verified email matches deterministically", () => {
    const report = buildIdentityReconciliationReport({
      staff: [
        { staffId: "staff-z", email: "Team@Example.com" },
        { staffId: "staff-a", email: "none@example.com" },
      ],
      identifiers: [
        { accountId: "acct-2", kind: "email", value: "team@example.com", verified: true },
        { accountId: "acct-1", kind: "email", value: "TEAM@example.com", verified: true },
      ],
    });

    assert.deepEqual(report.unique, []);
    assert.deepEqual(report.missing, [
      { staffId: "staff-a", emailNormalized: "none@example.com", reason: "no_verified_email_identifier" },
    ]);
    assert.deepEqual(report.ambiguous, [
      {
        staffId: "staff-z",
        emailNormalized: "team@example.com",
        accountIds: ["acct-1", "acct-2"],
        reason: "multiple_verified_email_identifiers",
      },
    ]);
  });

  it("leaves multiple staff competing for one account unresolved", () => {
    const report = buildIdentityReconciliationReport({
      staff: [
        { staffId: "staff-b", email: "Shared@Example.com" },
        { staffId: "staff-a", email: " shared@example.com " },
      ],
      identifiers: [
        { accountId: "acct-shared", kind: "email", value: "shared@example.com", verified: true },
      ],
    });

    assert.deepEqual(report.unique, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.ambiguous, [
      {
        staffId: "staff-a",
        emailNormalized: "shared@example.com",
        accountIds: ["acct-shared"],
        reason: "multiple_staff_for_verified_email",
      },
      {
        staffId: "staff-b",
        emailNormalized: "shared@example.com",
        accountIds: ["acct-shared"],
        reason: "multiple_staff_for_verified_email",
      },
    ]);
  });

  it("does not let unverified collisions block a single verified identifier", () => {
    const report = buildIdentityReconciliationReport({
      staff: [{ staffId: "staff-a", email: "collision@example.com" }],
      identifiers: [
        { accountId: "acct-unverified", kind: "email", value: "collision@example.com", verified: false },
        { accountId: "acct-verified", kind: "email", value: " COLLISION@example.com ", verified: true },
      ],
    });

    assert.deepEqual(report.unique, [
      { staffId: "staff-a", emailNormalized: "collision@example.com", accountId: "acct-verified" },
    ]);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.ambiguous, []);
  });

  it("leaves duplicate historical verified identifiers ambiguous", () => {
    const report = buildIdentityReconciliationReport({
      staff: [{ staffId: "staff-a", email: "dupe@example.com" }],
      identifiers: [
        { accountId: "acct-2", kind: "email", value: "DUPE@example.com", verified: true },
        { accountId: "acct-1", kind: "email", value: "dupe@example.com", verified: true },
        { accountId: "acct-1", kind: "email", value: " dupe@example.com ", verified: true },
      ],
    });

    assert.deepEqual(report.unique, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.ambiguous, [
      {
        staffId: "staff-a",
        emailNormalized: "dupe@example.com",
        accountIds: ["acct-1", "acct-2"],
        reason: "multiple_verified_email_identifiers",
      },
    ]);
  });

  it("leaves accounts already linked to another staff row unresolved", () => {
    const report = buildIdentityReconciliationReport({
      staff: [
        { staffId: "staff-linked", email: "holder@example.com", authAccountId: "acct-a" },
        { staffId: "staff-unlinked", email: "owner@example.com" },
      ],
      identifiers: [
        { accountId: "acct-a", kind: "email", value: "owner@example.com", verified: true },
      ],
    });

    assert.deepEqual(report.unique, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.ambiguous, [
      {
        staffId: "staff-unlinked",
        emailNormalized: "owner@example.com",
        accountIds: ["acct-a"],
        reason: "account_already_linked_to_staff",
      },
    ]);
  });

  it("reports missing and invalid empty email without matching display names", () => {
    const report = buildIdentityReconciliationReport({
      staff: [
        { staffId: "staff-empty", email: "   ", emailNormalized: " " },
        { staffId: "staff-name", email: "real@example.com", emailNormalized: "real@example.com" },
      ],
      identifiers: [
        { accountId: "acct-display", kind: "email", value: "Display Name", verified: true },
      ],
    });

    assert.deepEqual(report.unique, []);
    assert.deepEqual(report.missing, [
      { staffId: "staff-empty", emailNormalized: "", reason: "no_verified_email_identifier" },
      { staffId: "staff-name", emailNormalized: "real@example.com", reason: "no_verified_email_identifier" },
    ]);
    assert.deepEqual(report.ambiguous, []);
  });
});
