import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("lineage tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("configuration publication lineage", () => {
  it("rejects cross-stream supersedes_id and missing FK targets", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmConfigPublicationsTable, crmConfigChangesTable, crmSlaPoliciesTable, crmStaffTable } =
      await import("@workspace/db");
    const [basePolicy] = await db.select().from(crmSlaPoliciesTable).limit(1);
    const [author] = await db.select().from(crmStaffTable).limit(1);
    assert.ok(basePolicy && author);
    const suffix = randomUUID().slice(0, 8);
    const [policy] = await db
      .insert(crmSlaPoliciesTable)
      .values({
        key: `lineage-x-${suffix}`,
        name: `lineage-x-${suffix}`,
        firstResponseMinutes: basePolicy.firstResponseMinutes,
        nextResponseMinutes: basePolicy.nextResponseMinutes,
        resolutionMinutes: basePolicy.resolutionMinutes,
        timeZone: basePolicy.timeZone,
        holidays: basePolicy.holidays,
      })
      .returning();
    assert.ok(policy);
    const [changeA] = await db
      .insert(crmConfigChangesTable)
      .values({
        entityType: "sla_policy",
        entityId: policy.id,
        status: "published",
        afterValue: { name: policy.name },
        authorStaffId: author.id,
      })
      .returning();
    const stream = `macro-${suffix}`;
    const [otherChange] = await db
      .insert(crmConfigChangesTable)
      .values({
        entityType: "macro",
        entityId: stream,
        status: "published",
        afterValue: { name: "x" },
        authorStaffId: author.id,
      })
      .returning();
    const [pubA] = await db
      .insert(crmConfigPublicationsTable)
      .values({
        entityType: "sla_policy",
        entityId: policy.id,
        publishedVersion: 1,
        changeId: changeA!.id,
        afterValue: { name: policy.name },
      })
      .returning();
    const [pubB] = await db
      .insert(crmConfigPublicationsTable)
      .values({
        entityType: "macro",
        entityId: stream,
        publishedVersion: 1,
        changeId: otherChange!.id,
        afterValue: { name: "x" },
      })
      .returning();
    await assert.rejects(
      () =>
        db.insert(crmConfigPublicationsTable).values({
          entityType: "sla_policy",
          entityId: policy.id,
          publishedVersion: (pubA!.publishedVersion ?? 0) + 1,
          changeId: changeA!.id,
          supersedesId: pubB!.id,
          afterValue: { name: policy.name },
        }),
      /cross-stream|Failed query/,
    );
    await assert.rejects(
      () =>
        db.insert(crmConfigPublicationsTable).values({
          entityType: "sla_policy",
          entityId: policy.id,
          publishedVersion: (pubA!.publishedVersion ?? 0) + 2,
          changeId: changeA!.id,
          supersedesId: randomUUID(),
          afterValue: { name: policy.name },
        }),
      /foreign key|violates|cross-stream|Failed query/i,
    );
  });

  it("rejects rollback of a non-current publication", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmSlaPoliciesTable, crmStaffTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { createGovernedDraft } = await import("./configChangeCommands.ts");
    const { applyConfigChangeAction, currentPublishedVersion } = await import("./configTransition.ts");
    const [author] = await db.select().from(crmStaffTable).limit(1);
    const [basePolicy] = await db.select().from(crmSlaPoliciesTable).limit(1);
    assert.ok(author && basePolicy);
    const [policy] = await db
      .insert(crmSlaPoliciesTable)
      .values({
        key: `lineage-${randomUUID().slice(0, 8)}`,
        name: `lineage-${randomUUID().slice(0, 8)}`,
        firstResponseMinutes: basePolicy.firstResponseMinutes,
        nextResponseMinutes: basePolicy.nextResponseMinutes,
        resolutionMinutes: basePolicy.resolutionMinutes,
        timeZone: basePolicy.timeZone,
        holidays: basePolicy.holidays,
      })
      .returning();
    assert.ok(policy);
    const reviewer = (
      await db
        .insert(crmStaffTable)
        .values({
          email: `lin.${randomUUID().slice(0, 8)}@example.com`,
          emailNormalized: `lin.${randomUUID().slice(0, 8)}@example.com`,
          name: "lin",
          role: "admin",
          permissions: ["config.propose", "config.review", "config.publish"],
        })
        .returning()
    )[0];
    async function publishOnce(delta: number) {
      const [row] = await db.select().from(crmSlaPoliciesTable).where(eq(crmSlaPoliciesTable.id, policy.id));
      const draft = await createGovernedDraft({
        entityType: "sla_policy",
        entityId: policy.id,
        authorStaffId: author.id,
        afterValue: { firstResponseMinutes: (row?.firstResponseMinutes ?? 15) + delta, name: policy.name },
        beforeValue: { firstResponseMinutes: row?.firstResponseMinutes ?? 15, name: policy.name },
      });
      const actor = { id: author.id, role: "admin", permissions: ["config.propose", "config.review", "config.publish"] };
      const reviewerActor = {
        id: reviewer!.id,
        role: "admin",
        permissions: ["config.propose", "config.review", "config.publish"],
      };
      await applyConfigChangeAction({
        changeId: draft.id,
        action: "submit_review",
        actor,
        expectedLockVersion: draft.lockVersion,
      });
      const afterSubmit = await (await import("./configChangeCommands.ts")).loadChange(draft.id);
      await applyConfigChangeAction({
        changeId: draft.id,
        action: "approve",
        actor: reviewerActor,
        expectedLockVersion: afterSubmit!.lockVersion,
      });
      const afterApprove = await (await import("./configChangeCommands.ts")).loadChange(draft.id);
      const liveNow = await currentPublishedVersion("sla_policy", policy.id);
      return applyConfigChangeAction({
        changeId: draft.id,
        action: "publish",
        actor: reviewerActor,
        expectedLockVersion: afterApprove!.lockVersion,
        expectedPublishedVersion: liveNow?.publishedVersion ?? 0,
      });
    }
    const first = await publishOnce(21);
    await publishOnce(22);
    await assert.rejects(
      () =>
        applyConfigChangeAction({
          changeId: first.change.id,
          action: "rollback",
          actor: { id: author.id, role: "admin", permissions: ["config.publish"] },
          expectedLockVersion: first.change.lockVersion,
          expectedPublishedVersion: first.change.publishedVersion ?? 0,
        }),
      /current publication|Stale/,
    );
  });
});
