import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("marketing CMS PG tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("marketing CMS PostgreSQL lifecycle", () => {
  it("covers dual control, concurrency, schedule publish, rollback, and authorization", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const {
      db,
      crmStaffTable,
      crmMarketingDocumentsTable,
      crmMarketingVersionsTable,
      crmMarketingAuditTable,
    } = await import("@workspace/db");
    const {
      assertMarketingTransition,
      compareMarketingVersions,
    } = await import("./marketingLifecycle.ts");
    const {
      updateMarketingDraft,
      createRollbackDraft,
      publishDueScheduledVersions,
    } = await import("./marketingCommands.ts");

    const suffix = randomUUID().slice(0, 8);
    const [author] = await db
      .insert(crmStaffTable)
      .values({
        email: `mkt.a.${suffix}@example.com`,
        emailNormalized: `mkt.a.${suffix}@example.com`,
        name: "Mkt Author",
        role: "admin",
        permissions: ["marketing.propose", "marketing.read"],
      })
      .returning();
    const [reviewer] = await db
      .insert(crmStaffTable)
      .values({
        email: `mkt.r.${suffix}@example.com`,
        emailNormalized: `mkt.r.${suffix}@example.com`,
        name: "Mkt Reviewer",
        role: "admin",
        permissions: ["marketing.review", "marketing.read"],
      })
      .returning();
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `mkt.p.${suffix}@example.com`,
        emailNormalized: `mkt.p.${suffix}@example.com`,
        name: "Mkt Publisher",
        role: "admin",
        permissions: ["marketing.publish", "marketing.propose", "marketing.read"],
      })
      .returning();
    const [sales] = await db
      .insert(crmStaffTable)
      .values({
        email: `mkt.s.${suffix}@example.com`,
        emailNormalized: `mkt.s.${suffix}@example.com`,
        name: "Mkt Sales",
        role: "sales",
        permissions: [],
      })
      .returning();
    assert.ok(author && reviewer && publisher && sales);

    const slug = `cms-${suffix}`;
    const [doc] = await db
      .insert(crmMarketingDocumentsTable)
      .values({ slug, contentType: "page" })
      .returning();
    assert.ok(doc);

    const [enDraft] = await db
      .insert(crmMarketingVersionsTable)
      .values({
        documentId: doc.id,
        locale: "en",
        version: 1,
        status: "draft",
        title: "Home EN",
        summary: "Summary",
        body: { hero: "hello" },
        seoTitle: "SEO EN",
        seoDescription: "Desc EN",
        authorStaffId: author.id,
      })
      .returning();
    const [arDraft] = await db
      .insert(crmMarketingVersionsTable)
      .values({
        documentId: doc.id,
        locale: "ar",
        version: 1,
        status: "draft",
        title: "Home AR",
        summary: "ملخص",
        body: { hero: "مرحبا" },
        seoTitle: "SEO AR",
        seoDescription: "Desc AR",
        authorStaffId: author.id,
      })
      .returning();
    assert.ok(enDraft && arDraft);

    assert.throws(
      () =>
        assertMarketingTransition({
          status: "draft",
          transition: "submit_review",
          actorStaffId: sales.id,
          authorStaffId: author.id,
          permissions: [],
        }),
      (err: Error & { status?: number }) => err.status === 403,
    );

    const edited = await updateMarketingDraft({
      versionId: enDraft.id,
      actorStaffId: author.id,
      expectedLockVersion: enDraft.lockVersion,
      title: "Home EN v1",
      body: { hero: "hello-edited" },
    });
    assert.equal(edited.lockVersion, enDraft.lockVersion + 1);
    await assert.rejects(
      () =>
        updateMarketingDraft({
          versionId: enDraft.id,
          actorStaffId: author.id,
          expectedLockVersion: enDraft.lockVersion,
          title: "stale",
        }),
      (err: Error & { status?: number }) => err.status === 409,
    );

    const diffs = compareMarketingVersions(
      {
        title: enDraft.title,
        summary: enDraft.summary,
        body: (enDraft.body as Record<string, unknown>) ?? {},
        seoTitle: enDraft.seoTitle,
        seoDescription: enDraft.seoDescription,
      },
      {
        title: edited.title,
        summary: edited.summary,
        body: (edited.body as Record<string, unknown>) ?? {},
        seoTitle: edited.seoTitle,
        seoDescription: edited.seoDescription,
      },
    );
    assert.ok(diffs.some((d) => d.field === "title" || d.field === "body"));

    async function transition(
      versionId: string,
      transition: Parameters<typeof assertMarketingTransition>[0]["transition"],
      actor: { id: string; permissions: string[] },
      extras?: { scheduledAt?: Date },
    ) {
      const [version] = await db
        .select()
        .from(crmMarketingVersionsTable)
        .where(eq(crmMarketingVersionsTable.id, versionId))
        .limit(1);
      assert.ok(version);
      const nextStatus = assertMarketingTransition({
        status: version.status as Parameters<typeof assertMarketingTransition>[0]["status"],
        transition,
        actorStaffId: actor.id,
        authorStaffId: version.authorStaffId,
        permissions: actor.permissions,
        expectedLockVersion: version.lockVersion,
        currentLockVersion: version.lockVersion,
      });
      const [updated] = await db
        .update(crmMarketingVersionsTable)
        .set({
          status: nextStatus,
          lockVersion: version.lockVersion + 1,
          reviewerStaffId: transition === "approve" ? actor.id : version.reviewerStaffId,
          publisherStaffId: transition === "publish" ? actor.id : version.publisherStaffId,
          scheduledAt: extras?.scheduledAt ?? version.scheduledAt,
          publishedAt: transition === "publish" ? new Date() : version.publishedAt,
          updatedAt: new Date(),
        })
        .where(eq(crmMarketingVersionsTable.id, version.id))
        .returning();
      assert.ok(updated);
      await db.insert(crmMarketingAuditTable).values({
        documentId: version.documentId,
        versionId: version.id,
        action: `marketing.${transition}`,
        actorStaffId: actor.id,
        beforeValue: { status: version.status },
        afterValue: { status: nextStatus },
      });
      return updated;
    }

    await transition(edited.id, "submit_review", {
      id: author.id,
      permissions: ["marketing.propose"],
    });
    await transition(edited.id, "request_changes", {
      id: reviewer.id,
      permissions: ["marketing.review"],
    });
    await transition(edited.id, "submit_review", {
      id: author.id,
      permissions: ["marketing.propose"],
    });
    await transition(edited.id, "approve", {
      id: reviewer.id,
      permissions: ["marketing.review"],
    });

    const past = new Date(Date.now() - 60_000);
    await transition(
      edited.id,
      "schedule",
      { id: publisher.id, permissions: ["marketing.publish"] },
      { scheduledAt: past },
    );

    // AR path: approve + publish so peer locale exists
    await transition(arDraft.id, "submit_review", {
      id: author.id,
      permissions: ["marketing.propose"],
    });
    await transition(arDraft.id, "approve", {
      id: reviewer.id,
      permissions: ["marketing.review"],
    });
    await transition(arDraft.id, "publish", {
      id: publisher.id,
      permissions: ["marketing.publish"],
    });

    const due = await publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher.id });
    assert.ok(due.published.includes(edited.id), JSON.stringify(due));

    const [publishedEn] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, edited.id))
      .limit(1);
    assert.equal(publishedEn?.status, "published");

    const rollback = await createRollbackDraft({
      versionId: publishedEn!.id,
      actorStaffId: author.id,
      permissions: ["marketing.propose"],
    });
    assert.equal(rollback.status, "draft");
    assert.equal(rollback.supersedesVersionId, publishedEn!.id);
    assert.ok(rollback.version > publishedEn!.version);

    await assert.rejects(
      () =>
        createRollbackDraft({
          versionId: publishedEn!.id,
          actorStaffId: sales.id,
          permissions: [],
        }),
      (err: Error & { status?: number }) => err.status === 403,
    );

    const audit = await db
      .select()
      .from(crmMarketingAuditTable)
      .where(eq(crmMarketingAuditTable.documentId, doc.id));
    assert.ok(audit.length >= 5);
    assert.ok(audit.some((a) => a.action === "marketing.scheduled_publish"));
    assert.ok(audit.some((a) => a.action === "marketing.rollback_draft"));
  });

  it("two scheduler instances publish a due version exactly once", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const {
      db,
      crmStaffTable,
      crmMarketingDocumentsTable,
      crmMarketingVersionsTable,
      crmMarketingAuditTable,
    } = await import("@workspace/db");
    const { publishDueScheduledVersions } = await import("./marketingCommands.ts");
    const suffix = randomUUID().slice(0, 8);
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `sched.${suffix}@example.com`,
        emailNormalized: `sched.${suffix}@example.com`,
        name: "Scheduler",
        role: "admin",
        permissions: ["marketing.publish", "marketing.read"],
      })
      .returning();
    assert.ok(publisher);
    const [doc] = await db
      .insert(crmMarketingDocumentsTable)
      .values({ slug: `dual-sched-${suffix}`, contentType: "page" })
      .returning();
    assert.ok(doc);
    // Peer locale already published so scheduled EN can validate.
    await db.insert(crmMarketingVersionsTable).values({
      documentId: doc.id,
      locale: "ar",
      version: 1,
      status: "published",
      title: "AR",
      summary: "s",
      body: { hero: "ar" },
      seoTitle: "AR",
      seoDescription: "AR",
      authorStaffId: publisher.id,
      publisherStaffId: publisher.id,
      publishedAt: new Date(),
    });
    const [scheduled] = await db
      .insert(crmMarketingVersionsTable)
      .values({
        documentId: doc.id,
        locale: "en",
        version: 1,
        status: "scheduled",
        title: "EN due",
        summary: "s",
        body: { hero: "en" },
        seoTitle: "EN",
        seoDescription: "EN",
        authorStaffId: publisher.id,
        publisherStaffId: publisher.id,
        scheduledAt: new Date(Date.now() - 5_000),
        lockVersion: 3,
      })
      .returning();
    assert.ok(scheduled);

    const [a, b] = await Promise.all([
      publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher.id }),
      publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher.id }),
    ]);
    const publishedIds = [...a.published, ...b.published];
    assert.equal(publishedIds.filter((id) => id === scheduled.id).length, 1);
    const audits = await db
      .select()
      .from(crmMarketingAuditTable)
      .where(eq(crmMarketingAuditTable.versionId, scheduled.id));
    assert.equal(audits.filter((row) => row.action === "marketing.scheduled_publish").length, 1);
  });

  it("two simultaneous editors collide on lock version", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const {
      db,
      crmStaffTable,
      crmMarketingDocumentsTable,
      crmMarketingVersionsTable,
    } = await import("@workspace/db");
    const { updateMarketingDraft } = await import("./marketingCommands.ts");
    const suffix = randomUUID().slice(0, 8);
    const [a] = await db
      .insert(crmStaffTable)
      .values({
        email: `ed.a.${suffix}@example.com`,
        emailNormalized: `ed.a.${suffix}@example.com`,
        name: "Editor A",
        role: "admin",
        permissions: ["marketing.propose", "marketing.read"],
      })
      .returning();
    const [b] = await db
      .insert(crmStaffTable)
      .values({
        email: `ed.b.${suffix}@example.com`,
        emailNormalized: `ed.b.${suffix}@example.com`,
        name: "Editor B",
        role: "admin",
        permissions: ["marketing.propose", "marketing.read"],
      })
      .returning();
    const [doc] = await db
      .insert(crmMarketingDocumentsTable)
      .values({ slug: `dual-edit-${suffix}`, contentType: "page" })
      .returning();
    const [draft] = await db
      .insert(crmMarketingVersionsTable)
      .values({
        documentId: doc!.id,
        locale: "en",
        version: 1,
        status: "draft",
        title: "Shared",
        summary: "s",
        body: { hero: "x" },
        seoTitle: "SEO",
        seoDescription: "Desc",
        authorStaffId: a!.id,
        lockVersion: 1,
      })
      .returning();
    assert.ok(draft && a && b);

    const results = await Promise.allSettled([
      updateMarketingDraft({
        versionId: draft.id,
        actorStaffId: a.id,
        expectedLockVersion: 1,
        title: "From A",
      }),
      updateMarketingDraft({
        versionId: draft.id,
        actorStaffId: b.id,
        expectedLockVersion: 1,
        title: "From B",
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const err = (rejected[0] as PromiseRejectedResult).reason as Error & { status?: number };
    assert.equal(err.status, 409);
  });
});

async function makePublishableDueVersion(tag: string, publisherId: string) {
  const { db, crmMarketingDocumentsTable, crmMarketingVersionsTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [doc] = await db
    .insert(crmMarketingDocumentsTable)
    .values({ slug: `fail-${tag}-${suffix}`, contentType: "page" })
    .returning();
  await db.insert(crmMarketingVersionsTable).values({
    documentId: doc!.id,
    locale: "ar",
    version: 1,
    status: "published",
    title: "AR",
    summary: "s",
    body: { hero: "ar" },
    seoTitle: "AR",
    seoDescription: "AR",
    authorStaffId: publisherId,
    publisherStaffId: publisherId,
    publishedAt: new Date(),
  });
  const [scheduled] = await db
    .insert(crmMarketingVersionsTable)
    .values({
      documentId: doc!.id,
      locale: "en",
      version: 1,
      status: "scheduled",
      title: `EN ${tag}`,
      summary: "s",
      body: { hero: "en" },
      seoTitle: "EN",
      seoDescription: "EN",
      authorStaffId: publisherId,
      publisherStaffId: publisherId,
      scheduledAt: new Date(Date.now() - 5_000),
      lockVersion: 1,
    })
    .returning();
  return { doc: doc!, scheduled: scheduled! };
}

describe("marketing CMS failure + recovery (PostgreSQL)", () => {
  it("cache invalidation failure does not roll back the publish; records a retryable audit and reconcile job", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmMarketingVersionsTable, crmMarketingAuditTable, crmJobsTable } = await import(
      "@workspace/db"
    );
    const { eq, and } = await import("drizzle-orm");
    const { publishDueScheduledVersions } = await import("./marketingCommands.ts");
    const suffix = randomUUID().slice(0, 8);
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `fail.cache.${suffix}@example.com`,
        emailNormalized: `fail.cache.${suffix}@example.com`,
        name: "Cache Fail Publisher",
        role: "admin",
        permissions: ["marketing.publish", "marketing.read"],
      })
      .returning();
    const { scheduled } = await makePublishableDueVersion("cache", publisher!.id);

    process.env.CRM_MARKETING_FAIL_CACHE = "1";
    let result;
    try {
      result = await publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher!.id });
    } finally {
      delete process.env.CRM_MARKETING_FAIL_CACHE;
    }
    assert.ok(result.published.includes(scheduled.id), JSON.stringify(result));
    assert.ok(result.recoverable.some((r) => r.id === scheduled.id && r.kind === "cache"));

    const [version] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, scheduled.id))
      .limit(1);
    assert.equal(version?.status, "published", "publish must not be rolled back by a cache-invalidation failure");

    const failureAudit = await db
      .select()
      .from(crmMarketingAuditTable)
      .where(
        and(
          eq(crmMarketingAuditTable.versionId, scheduled.id),
          eq(crmMarketingAuditTable.action, "marketing.cache_invalidate_failed"),
        ),
      );
    assert.equal(failureAudit.length, 1);
    assert.equal((failureAudit[0]!.afterValue as { retryable?: boolean })?.retryable, true);

    const reconcileJobs = await db
      .select()
      .from(crmJobsTable)
      .where(eq(crmJobsTable.type, "marketing_reconcile_publish"));
    assert.ok(reconcileJobs.some((j) => (j.payload as { versionId?: string })?.versionId === scheduled.id));
  });

  it("notification failure does not roll back the publish; records a retryable audit", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmMarketingVersionsTable, crmMarketingAuditTable } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const { publishDueScheduledVersions } = await import("./marketingCommands.ts");
    const suffix = randomUUID().slice(0, 8);
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `fail.notify.${suffix}@example.com`,
        emailNormalized: `fail.notify.${suffix}@example.com`,
        name: "Notify Fail Publisher",
        role: "admin",
        permissions: ["marketing.publish", "marketing.read"],
      })
      .returning();
    const { scheduled } = await makePublishableDueVersion("notify", publisher!.id);

    process.env.CRM_MARKETING_FAIL_NOTIFY = "1";
    let result;
    try {
      result = await publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher!.id });
    } finally {
      delete process.env.CRM_MARKETING_FAIL_NOTIFY;
    }
    assert.ok(result.published.includes(scheduled.id), JSON.stringify(result));
    assert.ok(result.recoverable.some((r) => r.id === scheduled.id && r.kind === "notify"));

    const [version] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, scheduled.id))
      .limit(1);
    assert.equal(version?.status, "published", "publish must not be rolled back by a notification failure");

    const failureAudit = await db
      .select()
      .from(crmMarketingAuditTable)
      .where(
        and(
          eq(crmMarketingAuditTable.versionId, scheduled.id),
          eq(crmMarketingAuditTable.action, "marketing.notify_failed"),
        ),
      );
    assert.equal(failureAudit.length, 1);
  });

  it("publication transaction failure leaves the version scheduled and audits the failure (not published)", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmMarketingVersionsTable, crmMarketingAuditTable } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const { publishDueScheduledVersions } = await import("./marketingCommands.ts");
    const suffix = randomUUID().slice(0, 8);
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `fail.tx.${suffix}@example.com`,
        emailNormalized: `fail.tx.${suffix}@example.com`,
        name: "TX Fail Publisher",
        role: "admin",
        permissions: ["marketing.publish", "marketing.read"],
      })
      .returning();
    const { scheduled } = await makePublishableDueVersion("tx", publisher!.id);

    process.env.CRM_MARKETING_FAIL_PUBLISH_TX = "1";
    let result;
    try {
      result = await publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher!.id });
    } finally {
      delete process.env.CRM_MARKETING_FAIL_PUBLISH_TX;
    }
    assert.ok(result.failed.some((f) => f.id === scheduled.id), JSON.stringify(result));
    assert.equal(result.published.includes(scheduled.id), false);

    const [version] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, scheduled.id))
      .limit(1);
    assert.equal(version?.status, "scheduled", "a failed publish transaction must leave the version scheduled");

    const failureAudit = await db
      .select()
      .from(crmMarketingAuditTable)
      .where(
        and(
          eq(crmMarketingAuditTable.versionId, scheduled.id),
          eq(crmMarketingAuditTable.action, "marketing.scheduled_publish_failed"),
        ),
      );
    assert.equal(failureAudit.length, 1);

    // Once the injected failure is cleared, the same due row can be retried and completes.
    const retried = await publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher!.id });
    assert.ok(retried.published.includes(scheduled.id));
  });

  it("reconcilePublish retries a previously failed cache invalidation for an already-published version", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmMarketingAuditTable } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const { publishDueScheduledVersions } = await import("./marketingCommands.ts");
    const { reconcilePublish } = await import("./marketingPublishing.ts");
    const suffix = randomUUID().slice(0, 8);
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `fail.reconcile.${suffix}@example.com`,
        emailNormalized: `fail.reconcile.${suffix}@example.com`,
        name: "Reconcile Publisher",
        role: "admin",
        permissions: ["marketing.publish", "marketing.read"],
      })
      .returning();
    const { scheduled } = await makePublishableDueVersion("reconcile", publisher!.id);

    process.env.CRM_MARKETING_FAIL_CACHE = "1";
    try {
      await publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher!.id });
    } finally {
      delete process.env.CRM_MARKETING_FAIL_CACHE;
    }

    const result = await reconcilePublish({ versionId: scheduled.id, kind: "cache", actorStaffId: publisher!.id });
    assert.equal(result.cache, "ok");

    const successAudit = await db
      .select()
      .from(crmMarketingAuditTable)
      .where(
        and(
          eq(crmMarketingAuditTable.versionId, scheduled.id),
          eq(crmMarketingAuditTable.action, "marketing.cache_invalidate"),
        ),
      );
    assert.ok(successAudit.length >= 1, "reconcile should record a successful cache_invalidate audit entry");
  });

  it("worker crash mid-publish: an interrupted worker's lost lease lets a subsequent claim finish the batch", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmMarketingVersionsTable, crmJobsTable } = await import("@workspace/db");
    const { eq, and, inArray, sql } = await import("drizzle-orm");
    const jobsModule = await import("./jobs.ts");
    const { publishDueScheduledVersions } = await import("./marketingCommands.ts");

    const suffix = randomUUID().slice(0, 8);
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `crash.${suffix}@example.com`,
        emailNormalized: `crash.${suffix}@example.com`,
        name: "Crash Publisher",
        role: "admin",
        permissions: ["marketing.publish", "marketing.read"],
      })
      .returning();
    const { scheduled: first } = await makePublishableDueVersion(`crash-a-${suffix}`, publisher!.id);
    const { scheduled: second } = await makePublishableDueVersion(`crash-b-${suffix}`, publisher!.id);

    // Claim our own job row directly by id (rather than via the generic
    // claimJobs pool scan), since the shared verify DB accumulates a large
    // backlog of unrelated stale pending jobs from other test files. A
    // partial unique index allows only one pending/running row of this type
    // at a time, so reuse a leftover one (e.g. from a prior interrupted test
    // run) instead of inserting a fresh row that would violate it.
    const [existingJob] = await db
      .select({ id: crmJobsTable.id })
      .from(crmJobsTable)
      .where(and(eq(crmJobsTable.type, "marketing_publish_due"), inArray(crmJobsTable.status, ["pending", "running"])))
      .limit(1);
    const jobId = existingJob
      ? existingJob.id
      : (
          await db
            .insert(crmJobsTable)
            .values({ type: "marketing_publish_due", payload: { scheduled: true } })
            .returning({ id: crmJobsTable.id })
        )[0]!.id;

    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_TEST_SIDE_EFFECT_DELAY_MS = "250";
    process.env.CRM_JOB_HEARTBEAT_MS = "40";

    const [claimedRow] = await db
      .update(crmJobsTable)
      .set({
        status: "running",
        attempts: sql`${crmJobsTable.attempts} + 1`,
        lockedAt: new Date(),
        lockedBy: "crash-worker-a",
        leaseExpiresAt: new Date(Date.now() + 30_000),
        claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
      })
      .where(eq(crmJobsTable.id, jobId))
      .returning();
    const job = claimedRow;
    assert.ok(job, "expected to claim the marketing_publish_due job");

    const running = jobsModule.executeClaimedCrmJob(job!, "crash-worker-a");
    // Give the handler time to fully publish the first due row before its
    // between-rows delay checkpoint (where we simulate the crash).
    await new Promise((r) => setTimeout(r, 90));
    await db
      .update(crmJobsTable)
      .set({ lockedBy: "crash-worker-b", claimGeneration: 99_999 })
      .where(eq(crmJobsTable.id, job!.id));
    await running;

    const [afterFirst] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, first.id))
      .limit(1);
    const [afterSecond] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, second.id))
      .limit(1);
    assert.equal(afterFirst?.status, "published", "row processed before lease loss should remain published");
    assert.equal(afterSecond?.status, "scheduled", "row not yet reached when ownership was lost stays scheduled");

    // A subsequent worker claim (post lease-expiry, or here a direct retry
    // once the job is no longer owned by worker-a) finishes the remaining work.
    const finish = await publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher!.id });
    assert.ok(finish.published.includes(second.id));
  });

  it("duplicate marketing scheduler inserts at most one pending/running marketing_publish_due job", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq, and, inArray } = await import("drizzle-orm");
    const { scheduleMarketingPublishDue } = await import("./queue.ts");
    await scheduleMarketingPublishDue();
    await scheduleMarketingPublishDue();
    const rows = await db
      .select({ id: crmJobsTable.id, status: crmJobsTable.status })
      .from(crmJobsTable)
      .where(and(eq(crmJobsTable.type, "marketing_publish_due"), inArray(crmJobsTable.status, ["pending", "running"])));
    assert.ok(rows.length <= 1, `expected unique scheduler row, got ${rows.length}`);
  });

  it("concurrent reconcilePublish attempts are idempotent for cache recovery", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable } = await import("@workspace/db");
    const { publishDueScheduledVersions } = await import("./marketingCommands.ts");
    const { reconcilePublish } = await import("./marketingPublishing.ts");
    const suffix = randomUUID().slice(0, 8);
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `recon.conc.${suffix}@example.com`,
        emailNormalized: `recon.conc.${suffix}@example.com`,
        name: "Reconcile Concurrent",
        role: "admin",
        permissions: ["marketing.publish", "marketing.read"],
      })
      .returning();
    const { scheduled } = await makePublishableDueVersion(`recon-${suffix}`, publisher!.id);
    process.env.CRM_MARKETING_FAIL_CACHE = "1";
    try {
      await publishDueScheduledVersions({ now: new Date(), actorStaffId: publisher!.id });
    } finally {
      delete process.env.CRM_MARKETING_FAIL_CACHE;
    }
    const settled = await Promise.allSettled([
      reconcilePublish({ versionId: scheduled.id, kind: "cache", actorStaffId: publisher!.id }),
      reconcilePublish({ versionId: scheduled.id, kind: "cache", actorStaffId: publisher!.id }),
    ]);
    const ok = settled.filter((r) => r.status === "fulfilled");
    assert.equal(ok.length, 2);
    for (const r of ok) {
      assert.equal((r as PromiseFulfilledResult<{ cache?: string }>).value.cache, "ok");
    }
  });
});
