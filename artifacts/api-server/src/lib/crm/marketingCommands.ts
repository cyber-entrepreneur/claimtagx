import { and, eq, lte, max, sql } from "drizzle-orm";
import {
  db,
  crmMarketingAuditTable,
  crmMarketingDocumentsTable,
  crmMarketingVersionsTable,
  type DbSession,
} from "@workspace/db";
import { writeAudit } from "./audit";
import { validateMarketingPublication } from "./marketingLifecycle";
import { shouldSimulateMarketingFailure } from "./marketingPublishing";
import { delayIfTestJob, LostOwnershipError, type JobRunContext } from "./queue";

export async function updateMarketingDraft(params: {
  versionId: string;
  actorStaffId: string;
  expectedLockVersion: number;
  title?: string;
  summary?: string | null;
  body?: Record<string, unknown>;
  seoTitle?: string | null;
  seoDescription?: string | null;
  robots?: string | null;
}) {
  const [version] = await db
    .select()
    .from(crmMarketingVersionsTable)
    .where(eq(crmMarketingVersionsTable.id, params.versionId))
    .limit(1);
  if (!version) throw Object.assign(new Error("Version not found"), { status: 404 });
  if (version.status !== "draft" && version.status !== "changes_requested") {
    throw Object.assign(new Error("Only draft or changes_requested versions can be edited"), { status: 409 });
  }
  if (version.lockVersion !== params.expectedLockVersion) {
    throw Object.assign(new Error("Version lock mismatch. Refresh and retry."), { status: 409 });
  }
  const [updated] = await db
    .update(crmMarketingVersionsTable)
    .set({
      title: params.title ?? version.title,
      summary: params.summary === undefined ? version.summary : params.summary,
      body: params.body ?? version.body,
      seoTitle: params.seoTitle === undefined ? version.seoTitle : params.seoTitle,
      seoDescription: params.seoDescription === undefined ? version.seoDescription : params.seoDescription,
      robots: params.robots === undefined ? version.robots : params.robots,
      lockVersion: version.lockVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(crmMarketingVersionsTable.id, version.id),
        eq(crmMarketingVersionsTable.lockVersion, version.lockVersion),
      ),
    )
    .returning();
  if (!updated) throw Object.assign(new Error("Version lock mismatch. Refresh and retry."), { status: 409 });
  await db.insert(crmMarketingAuditTable).values({
    documentId: version.documentId,
    versionId: version.id,
    action: "marketing.edit_draft",
    actorStaffId: params.actorStaffId,
    beforeValue: { lockVersion: version.lockVersion },
    afterValue: { lockVersion: updated.lockVersion },
  });
  return updated;
}

/** Rollback = create a successor draft cloned from a published/archived version. */
export async function createRollbackDraft(params: {
  versionId: string;
  actorStaffId: string;
  permissions: string[];
}) {
  if (!params.permissions.includes("marketing.propose")) {
    throw Object.assign(new Error("Insufficient marketing permission"), { status: 403 });
  }
  const [source] = await db
    .select()
    .from(crmMarketingVersionsTable)
    .where(eq(crmMarketingVersionsTable.id, params.versionId))
    .limit(1);
  if (!source) throw Object.assign(new Error("Version not found"), { status: 404 });
  if (source.status !== "published" && source.status !== "archived" && source.status !== "superseded") {
    throw Object.assign(new Error("Rollback source must be published, archived, or superseded"), { status: 409 });
  }
  const [{ maxVersion }] = await db
    .select({ maxVersion: max(crmMarketingVersionsTable.version) })
    .from(crmMarketingVersionsTable)
    .where(
      and(eq(crmMarketingVersionsTable.documentId, source.documentId), eq(crmMarketingVersionsTable.locale, source.locale)),
    );
  const nextVersion = Number(maxVersion ?? 0) + 1;
  const [draft] = await db
    .insert(crmMarketingVersionsTable)
    .values({
      documentId: source.documentId,
      locale: source.locale,
      version: nextVersion,
      status: "draft",
      title: source.title,
      summary: source.summary,
      body: source.body,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      robots: source.robots,
      supersedesVersionId: source.id,
      authorStaffId: params.actorStaffId,
    })
    .returning();
  await db.insert(crmMarketingAuditTable).values({
    documentId: source.documentId,
    versionId: draft!.id,
    action: "marketing.rollback_draft",
    actorStaffId: params.actorStaffId,
    beforeValue: { sourceVersionId: source.id, sourceVersion: source.version },
    afterValue: { draftVersionId: draft!.id, draftVersion: nextVersion },
  });
  return draft!;
}

export async function publishDueScheduledVersions(params?: {
  now?: Date;
  actorStaffId?: string;
  executor?: DbSession;
  ctx?: JobRunContext;
}): Promise<{
  published: string[];
  failed: Array<{ id: string; error: string }>;
  recoverable: Array<{ id: string; kind: "cache" | "notify" }>;
}> {
  const now = params?.now ?? new Date();
  const executor = params?.executor ?? db;
  const due = await executor
    .select()
    .from(crmMarketingVersionsTable)
    .where(and(eq(crmMarketingVersionsTable.status, "scheduled"), lte(crmMarketingVersionsTable.scheduledAt, now)))
    .limit(50);
  const published: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const recoverable: Array<{ id: string; kind: "cache" | "notify" }> = [];
  for (const version of due) {
    if (params?.ctx?.signal.aborted) throw new LostOwnershipError(params.ctx.jobId);
    try {
      if (shouldSimulateMarketingFailure("CRM_MARKETING_FAIL_PUBLISH_TX")) {
        throw new Error("Simulated publish transaction failure");
      }
      const peers = await executor
        .select()
        .from(crmMarketingVersionsTable)
        .where(
          and(
            eq(crmMarketingVersionsTable.documentId, version.documentId),
            eq(crmMarketingVersionsTable.status, "published"),
          ),
        );
      const issues = validateMarketingPublication({
        locale: version.locale,
        title: version.title,
        seoTitle: version.seoTitle,
        seoDescription: version.seoDescription,
        body: (version.body as Record<string, unknown>) ?? {},
        requiredLocales: ["en", "ar"],
        peerLocalesPublished: peers.map((p) => p.locale).concat(version.locale),
      });
      if (issues.filter((i) => !i.startsWith("missingLocale:")).length) {
        throw new Error(`Publication validation failed: ${issues.join(",")}`);
      }
      // Supersede previous published for same locale
      const previous = peers.filter((p) => p.locale === version.locale);
      for (const prev of previous) {
        await executor
          .update(crmMarketingVersionsTable)
          .set({ status: "superseded", updatedAt: now })
          .where(eq(crmMarketingVersionsTable.id, prev.id));
      }
      const [updated] = await executor
        .update(crmMarketingVersionsTable)
        .set({
          status: "published",
          publishedAt: now,
          publisherStaffId: params?.actorStaffId ?? version.publisherStaffId,
          lockVersion: sql`${crmMarketingVersionsTable.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(crmMarketingVersionsTable.id, version.id),
            eq(crmMarketingVersionsTable.status, "scheduled"),
            eq(crmMarketingVersionsTable.lockVersion, version.lockVersion),
          ),
        )
        .returning();
      if (!updated) throw new Error("Scheduled publish race lost");
      await executor.insert(crmMarketingAuditTable).values({
        documentId: version.documentId,
        versionId: version.id,
        action: "marketing.scheduled_publish",
        actorStaffId: params?.actorStaffId ?? null,
        beforeValue: { status: "scheduled" },
        afterValue: { status: "published" },
      });
      if (params?.actorStaffId) {
        await writeAudit({
          actorType: "staff",
          actorId: params.actorStaffId,
          action: "marketing.scheduled_publish",
          entityType: "marketing_version",
          entityId: version.id,
          afterValue: { status: "published" },
        });
      }
      published.push(version.id);
      // The publish above already committed. Cache invalidation and stakeholder
      // notification are best-effort from here on: a failure in either MUST NOT
      // roll back or unpublish the version — it is recorded as a retryable,
      // audited failure and a `marketing_reconcile_publish` job is enqueued.
      const { applyPostPublishSideEffects } = await import("./marketingPublishing");
      const effects = await applyPostPublishSideEffects({
        documentId: version.documentId,
        versionId: version.id,
        locale: version.locale,
        actorStaffId: params?.actorStaffId ?? null,
        reason: "scheduled_publish",
        notify: params?.actorStaffId
          ? { title: `Scheduled publish: ${version.title}`, body: `Locale ${version.locale} published by scheduler.` }
          : undefined,
      });
      if (effects.cache === "failed") recoverable.push({ id: version.id, kind: "cache" });
      if (effects.notify === "failed") recoverable.push({ id: version.id, kind: "notify" });
    } catch (err) {
      if (err instanceof LostOwnershipError) throw err;
      failed.push({ id: version.id, error: err instanceof Error ? err.message : "publish failed" });
      await executor.insert(crmMarketingAuditTable).values({
        documentId: version.documentId,
        versionId: version.id,
        action: "marketing.scheduled_publish_failed",
        actorStaffId: params?.actorStaffId ?? null,
        afterValue: { error: err instanceof Error ? err.message : "publish failed" },
      });
    }
    // Checked between rows (not before the first) so a worker that loses its
    // lease mid-batch leaves already-published rows published and only the
    // remaining scheduled rows available for the next worker's claim.
    if (params?.ctx) await delayIfTestJob(params.ctx);
  }
  return { published, failed, recoverable };
}
