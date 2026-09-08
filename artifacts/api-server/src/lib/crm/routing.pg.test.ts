import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { evaluateStaffEligibilityForTest, routeInquiry } from "./routing.ts";

describe("routing eligibility (unit)", () => {
  it("rejects OOO, capacity, region, language, and specialty mismatches", () => {
    const base = {
      region: "emea",
      languages: ["en", "ar"],
      specialties: ["sales"],
      oooUntil: null as Date | null,
      capacityLimit: 2,
      openCount: 0,
    };
    assert.equal(evaluateStaffEligibilityForTest(base, { region: "emea", locale: "en", inquiryType: "sales" }).ok, true);
    assert.equal(
      evaluateStaffEligibilityForTest({ ...base, oooUntil: new Date(Date.now() + 60_000) }, { inquiryType: "sales" })
        .reason,
      "out_of_office",
    );
    assert.equal(
      evaluateStaffEligibilityForTest({ ...base, openCount: 2 }, { inquiryType: "sales" }).reason,
      "at_capacity",
    );
    assert.equal(
      evaluateStaffEligibilityForTest(base, { region: "apac", inquiryType: "sales" }).reason,
      "region_mismatch",
    );
    assert.equal(
      evaluateStaffEligibilityForTest(base, { locale: "fr", inquiryType: "sales" }).reason,
      "language_mismatch",
    );
    assert.equal(
      evaluateStaffEligibilityForTest(base, { inquiryType: "billing" }).reason,
      "specialty_mismatch",
    );
  });
});

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("routing concurrency tests require isolated DATABASE_URL");
  }
}

describe("routing concurrency (PostgreSQL)", () => {
  it("concurrent round-robin with capacity=1 never double-assigns the constrained seat", async () => {
    requireIsolatedDb();
    const { db, crmStaffTable, crmTeamsTable, crmTeamMembersTable, crmRoutingRulesTable, crmInquiriesTable, crmContactsTable } =
      await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);

    const [team] = await db
      .insert(crmTeamsTable)
      .values({ slug: `cap-${suffix}`, name: `Capacity ${suffix}`, region: "global", roundRobinCursor: 0 })
      .returning();
    const [a] = await db
      .insert(crmStaffTable)
      .values({
        email: `cap.a.${suffix}@example.com`,
        emailNormalized: `cap.a.${suffix}@example.com`,
        name: "Cap A",
        role: "sales",
        status: "active",
        capacityLimit: 1,
        region: "global",
        languages: ["*"],
        specialties: ["*"],
      })
      .returning();
    const [b] = await db
      .insert(crmStaffTable)
      .values({
        email: `cap.b.${suffix}@example.com`,
        emailNormalized: `cap.b.${suffix}@example.com`,
        name: "Cap B",
        role: "sales",
        status: "active",
        capacityLimit: 1,
        region: "global",
        languages: ["*"],
        specialties: ["*"],
        oooUntil: new Date(Date.now() + 3600_000),
      })
      .returning();
    await db.insert(crmTeamMembersTable).values([
      { teamId: team!.id, staffId: a!.id, active: true },
      { teamId: team!.id, staffId: b!.id, active: true },
    ]);
    // Isolate: deactivate other rules briefly by inserting a high-priority rule
    await db.insert(crmRoutingRulesTable).values({
      name: `cap-rule-${suffix}`,
      priority: 1,
      status: "active",
      conditions: [],
      strategy: "round_robin",
      teamId: team!.id,
      reasonTemplate: `capacity test ${suffix}`,
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        return db.transaction(async (tx) => {
          const routed = await routeInquiry({ inquiryType: "sales", region: "global", locale: "en" }, tx);
          const [contact] = await tx
            .insert(crmContactsTable)
            .values({
              firstName: "R",
              lastName: `C${i}`,
              jobTitle: "B",
              email: `route.${suffix}.${i}@example.com`,
              emailNormalized: `route.${suffix}.${i}@example.com`,
              country: "US",
            })
            .returning();
          const [inq] = await tx
            .insert(crmInquiriesTable)
            .values({
              reference: `CTX-2099-R${suffix.slice(0, 4)}${i}`.toUpperCase(),
              contactId: contact!.id,
              inquiryType: "sales",
              status: routed.staffId ? "ASSIGNED" : "NEW",
              assignedTeamId: routed.teamId,
              assignedStaffId: routed.staffId,
              assignedReason: routed.reason,
            })
            .returning();
          return { staffId: routed.staffId, inquiryId: inq!.id, unassigned: routed.unassigned };
        });
      }),
    );

    const assignedToA = results.filter((r) => r.staffId === a!.id);
    assert.equal(assignedToA.length, 1, `expected exactly one assignment to capacity-1 staff, got ${assignedToA.length}`);
    assert.ok(results.some((r) => r.unassigned || r.staffId === null), "overflow must go unassigned while B is OOO");

    // Cursor advanced (no corruption)
    const [teamAfter] = await db.select().from(crmTeamsTable).where(eq(crmTeamsTable.id, team!.id)).limit(1);
    assert.ok((teamAfter?.roundRobinCursor ?? 0) >= 1);

    // Cleanup rule so it does not steal later tests
    await db.delete(crmRoutingRulesTable).where(eq(crmRoutingRulesTable.name, `cap-rule-${suffix}`));
  });
});
