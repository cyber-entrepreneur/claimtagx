import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ConfigChangeEvent } from "./configLifecycle.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("config transition tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

async function extraStaff(role = "admin") {
  const { db, crmStaffTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [row] = await db
    .insert(crmStaffTable)
    .values({
      email: `${role}.${suffix}@example.com`,
      emailNormalized: `${role}.${suffix}@example.com`,
      name: `${role} ${suffix}`,
      role,
      permissions: ["config.propose", "config.review", "config.publish", "config.emergency_bypass"],
    })
    .returning();
  return row!;
}

async function act(
  changeId: string,
  action: ConfigChangeEvent,
  actor: { id: string; role: string; permissions: string[] },
  extra?: { failAfter?: "live_apply" | "before_audit"; expectedLockVersion?: number; expectedPublishedVersion?: number },
) {
  const { loadChange } = await import("./configChangeCommands.ts");
  const { applyConfigChangeAction, currentPublishedVersion } = await import("./configTransition.ts");
  const row = await loadChange(changeId);
  assert.ok(row);
  const live = await currentPublishedVersion(row.entityType, row.entityId);
  return applyConfigChangeAction({
    changeId,
    action,
    actor,
    expectedLockVersion: extra?.expectedLockVersion ?? row.lockVersion,
    expectedPublishedVersion:
      extra?.expectedPublishedVersion ??
      (action === "publish" || action === "rollback" ? (live?.publishedVersion ?? 0) : undefined),
    failAfter: extra?.failAfter,
  });
}

describe("transactional configuration publish", () => {
  it("uses the production transition service for two-person publish and immutable audit", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmSlaPoliciesTable, crmStaffTable, crmAuditEventsTable, crmConfigPublicationsTable } =
      await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { createGovernedDraft } = await import("./configChangeCommands.ts");
    const [author] = await db.select().from(crmStaffTable).limit(1);
    const reviewer = await extraStaff("admin");
    const publisher = await extraStaff("admin");
    assert.ok(author);
    const [policy] = await db.select().from(crmSlaPoliciesTable).limit(1);
    assert.ok(policy);
    const before = policy.firstResponseMinutes;
    const draft = await createGovernedDraft({
      entityType: "sla_policy",
      entityId: policy.id,
      authorStaffId: author.id,
      afterValue: { firstResponseMinutes: before + 1, name: policy.name },
      beforeValue: { firstResponseMinutes: before, name: policy.name },
    });
    await act(draft.id, "submit_review", { id: author.id, role: "admin", permissions: ["config.propose"] });
    await assert.rejects(
      () => act(draft.id, "approve", { id: author.id, role: "owner", permissions: ["config.review"] }),
      /different reviewer/,
    );
    await assert.rejects(
      () => act(draft.id, "approve", { id: reviewer.id, role: "sales", permissions: [] }),
      /Missing config.review/,
    );
    await act(draft.id, "approve", { id: reviewer.id, role: "admin", permissions: ["config.review"] });
    await assert.rejects(
      () =>
        act(draft.id, "publish", { id: publisher.id, role: "admin", permissions: ["config.publish"] }, { expectedLockVersion: 0 }),
      /Stale lock version/,
    );
    const published = await act(draft.id, "publish", { id: publisher.id, role: "admin", permissions: ["config.publish"] });
    assert.equal(published.change.status, "published");
    assert.ok((published.change.publishedVersion ?? 0) >= 1);
    const pubs = await db
      .select()
      .from(crmConfigPublicationsTable)
      .where(eq(crmConfigPublicationsTable.changeId, draft.id));
    assert.equal(pubs.length, 1);
    const [updated] = await db.select().from(crmSlaPoliciesTable).where(eq(crmSlaPoliciesTable.id, policy.id)).limit(1);
    assert.equal(updated?.firstResponseMinutes, before + 1);
    await assert.rejects(
      () => act(draft.id, "publish", { id: publisher.id, role: "admin", permissions: ["config.publish"] }),
      /Cannot publish/,
    );
    await assert.rejects(async () => {
      await db.update(crmAuditEventsTable).set({ action: "tampered" }).where(eq(crmAuditEventsTable.entityId, policy.id));
    }, (err: unknown) => {
      const text = err instanceof Error ? `${err.message}\n${String((err as { cause?: unknown }).cause ?? "")}` : String(err);
      return /insert-only|immutable|crm_audit_events/i.test(text);
    });
  });

  it("rolls back a simulated failure after live apply without consuming a version", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmSlaPoliciesTable, crmStaffTable, crmConfigPublicationsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { createGovernedDraft } = await import("./configChangeCommands.ts");
    const { currentPublishedVersion } = await import("./configTransition.ts");
    const [author] = await db.select().from(crmStaffTable).limit(1);
    const reviewer = await extraStaff();
    const publisher = await extraStaff();
    const [policy] = await db.select().from(crmSlaPoliciesTable).limit(1);
    assert.ok(author && policy);
    const before = policy.firstResponseMinutes;
    const prior = await currentPublishedVersion("sla_policy", policy.id);
    const draft = await createGovernedDraft({
      entityType: "sla_policy",
      entityId: policy.id,
      authorStaffId: author.id,
      afterValue: { firstResponseMinutes: before + 5, name: policy.name },
      beforeValue: { firstResponseMinutes: before, name: policy.name },
    });
    await act(draft.id, "submit_review", { id: author.id, role: "admin", permissions: ["config.propose"] });
    await act(draft.id, "approve", { id: reviewer.id, role: "admin", permissions: ["config.review"] });
    await assert.rejects(
      () =>
        act(draft.id, "publish", { id: publisher.id, role: "admin", permissions: ["config.publish"] }, { failAfter: "live_apply" }),
      /simulated failure after live apply/,
    );
    const [still] = await db.select().from(crmSlaPoliciesTable).where(eq(crmSlaPoliciesTable.id, policy.id));
    assert.equal(still?.firstResponseMinutes, before);
    const after = await currentPublishedVersion("sla_policy", policy.id);
    assert.equal(after?.publishedVersion ?? null, prior?.publishedVersion ?? null);
    const dangling = await db
      .select()
      .from(crmConfigPublicationsTable)
      .where(eq(crmConfigPublicationsTable.changeId, draft.id));
    assert.equal(dangling.length, 0);
  });

  it("allocates sequential published versions and records rollback lineage", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmSlaPoliciesTable, crmStaffTable, crmConfigPublicationsTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");
    const { createGovernedDraft } = await import("./configChangeCommands.ts");
    const [author] = await db.select().from(crmStaffTable).limit(1);
    const reviewer = await extraStaff();
    const publisher = await extraStaff();
    const [policy] = await db.select().from(crmSlaPoliciesTable).limit(1);
    assert.ok(author && policy);
    const start = policy.firstResponseMinutes;
    async function publishDelta(delta: number) {
      const [live] = await db.select().from(crmSlaPoliciesTable).where(eq(crmSlaPoliciesTable.id, policy.id));
      const draft = await createGovernedDraft({
        entityType: "sla_policy",
        entityId: policy.id,
        authorStaffId: author.id,
        afterValue: { firstResponseMinutes: start + delta, name: policy.name },
        beforeValue: { firstResponseMinutes: live!.firstResponseMinutes, name: policy.name },
      });
      await act(draft.id, "submit_review", { id: author.id, role: "admin", permissions: ["config.propose"] });
      await act(draft.id, "approve", { id: reviewer.id, role: "admin", permissions: ["config.review"] });
      return act(draft.id, "publish", { id: publisher.id, role: "admin", permissions: ["config.publish"] });
    }
    const first = await publishDelta(11);
    const second = await publishDelta(12);
    assert.ok((second.change.publishedVersion ?? 0) > (first.change.publishedVersion ?? 0));
    const rolled = await act(second.change.id, "rollback", {
      id: publisher.id,
      role: "admin",
      permissions: ["config.publish"],
    });
    assert.equal(rolled.change.status, "rolled_back");
    const lineage = await db
      .select()
      .from(crmConfigPublicationsTable)
      .where(
        and(
          eq(crmConfigPublicationsTable.entityType, "sla_policy"),
          eq(crmConfigPublicationsTable.entityId, policy.id),
        ),
      );
    assert.equal(lineage.some((row) => row.rollbackOfId != null), true);
    const current = lineage.reduce((a, b) => (a.publishedVersion > b.publishedVersion ? a : b));
    assert.equal(current.rollbackOfId != null, true);
  });
});
