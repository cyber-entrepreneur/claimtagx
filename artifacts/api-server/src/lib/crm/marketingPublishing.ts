import { eq, and, inArray, desc } from "drizzle-orm";
import {
  db,
  crmMarketingAuditTable,
  crmMarketingDocumentsTable,
  crmMarketingVersionsTable,
  crmNotificationsTable,
  crmStaffTable,
  type DbSession,
} from "@workspace/db";
import { writeAudit } from "./audit";
import { enqueueJob } from "./queue";

/**
 * Test-only failure injection. Never gated behind anything but explicit env vars,
 * and effectively unreachable unless a test process sets them.
 *   CRM_MARKETING_FAIL_CACHE=1   -> invalidateMarketingCache throws
 *   CRM_MARKETING_FAIL_NOTIFY=1  -> notifyMarketingStakeholders throws
 *   CRM_MARKETING_FAIL_PUBLISH_TX=1 -> the publish transaction itself throws
 */
export function shouldSimulateMarketingFailure(flag: "CRM_MARKETING_FAIL_CACHE" | "CRM_MARKETING_FAIL_NOTIFY" | "CRM_MARKETING_FAIL_PUBLISH_TX"): boolean {
  return process.env[flag] === "1";
}

/**
 * Records cache invalidation / revalidation intent for published marketing content.
 * Downstream CDN/edge revalidation can subscribe to these audit events or poll.
 */
export async function invalidateMarketingCache(
  params: {
    documentId: string;
    versionId: string;
    locale: string;
    slug?: string | null;
    actorStaffId?: string | null;
    reason: string;
  },
  executor: DbSession = db,
): Promise<void> {
  if (shouldSimulateMarketingFailure("CRM_MARKETING_FAIL_CACHE")) {
    throw new Error("Simulated marketing cache invalidation failure");
  }
  const slug =
    params.slug ??
    (
      await executor
        .select({ slug: crmMarketingDocumentsTable.slug })
        .from(crmMarketingDocumentsTable)
        .where(eq(crmMarketingDocumentsTable.id, params.documentId))
        .limit(1)
    )[0]?.slug;
  await executor.insert(crmMarketingAuditTable).values({
    documentId: params.documentId,
    versionId: params.versionId,
    action: "marketing.cache_invalidate",
    actorStaffId: params.actorStaffId ?? null,
    afterValue: {
      slug: slug ?? null,
      locale: params.locale,
      reason: params.reason,
      paths: slug
        ? [`/${params.locale === "ar" ? "ar/" : ""}${slug === "home" ? "" : slug}`.replace(/\/$/, "/") || "/"]
        : [],
    },
  });
  if (params.actorStaffId) {
    await writeAudit(
      {
        actorType: "staff",
        actorId: params.actorStaffId,
        action: "marketing.cache_invalidate",
        entityType: "marketing_document",
        entityId: params.documentId,
        afterValue: { slug, locale: params.locale, reason: params.reason },
      },
      executor,
    );
  }
}

export async function notifyMarketingStakeholders(
  params: {
    documentId: string;
    versionId: string;
    actorStaffId: string;
    title: string;
    body: string;
  },
  executor: DbSession = db,
): Promise<void> {
  if (shouldSimulateMarketingFailure("CRM_MARKETING_FAIL_NOTIFY")) {
    throw new Error("Simulated marketing notification failure");
  }
  const recipients = await executor
    .select({ id: crmStaffTable.id })
    .from(crmStaffTable)
    .where(and(eq(crmStaffTable.status, "active"), inArray(crmStaffTable.role, ["admin", "ops"])))
    .limit(50);
  for (const staff of recipients) {
    if (staff.id === params.actorStaffId) continue;
    await executor.insert(crmNotificationsTable).values({
      staffId: staff.id,
      type: "marketing_lifecycle",
      title: params.title,
      body: params.body,
    });
  }
  await executor.insert(crmMarketingAuditTable).values({
    documentId: params.documentId,
    versionId: params.versionId,
    action: "marketing.notify",
    actorStaffId: params.actorStaffId,
    afterValue: { recipientCount: recipients.filter((r) => r.id !== params.actorStaffId).length },
  });
}

/**
 * A publish (or scheduled publish) has already committed by the time cache
 * invalidation / notification run. Those steps are best-effort and MUST NOT
 * roll back an already-committed publish. On failure this records an
 * immutable, retryable audit trail entry and enqueues a reconcile job so an
 * operator (or the next worker) can retry — see reconcilePublish() and
 * POST /platform/contact/marketing/versions/:id/reconcile-publish.
 */
export async function recordRecoverablePublishFailure(
  params: {
    documentId: string;
    versionId: string;
    kind: "cache" | "notify";
    error: unknown;
    actorStaffId?: string | null;
  },
  executor: DbSession = db,
): Promise<void> {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  await executor.insert(crmMarketingAuditTable).values({
    documentId: params.documentId,
    versionId: params.versionId,
    action: params.kind === "cache" ? "marketing.cache_invalidate_failed" : "marketing.notify_failed",
    actorStaffId: params.actorStaffId ?? null,
    afterValue: { error: message.slice(0, 2000), retryable: true },
  });
  await enqueueJob(
    "marketing_reconcile_publish",
    { versionId: params.versionId, documentId: params.documentId, kind: params.kind },
    { idempotencyKey: `marketing-reconcile-${params.kind}-${params.versionId}` },
  );
}

/**
 * Runs cache invalidation and (optionally) stakeholder notification for an
 * already-published version. Each step is isolated: a failure in one never
 * blocks or rolls back the other, and never un-publishes the version. Safe
 * to call multiple times (idempotent audit + reconcile-job enqueue).
 */
export async function applyPostPublishSideEffects(
  params: {
    documentId: string;
    versionId: string;
    locale: string;
    slug?: string | null;
    actorStaffId?: string | null;
    reason: string;
    notify?: { title: string; body: string };
  },
  executor: DbSession = db,
): Promise<{ cache: "ok" | "failed"; notify: "ok" | "failed" | "skipped" }> {
  let cache: "ok" | "failed" = "ok";
  let notify: "ok" | "failed" | "skipped" = "skipped";
  try {
    await invalidateMarketingCache(
      {
        documentId: params.documentId,
        versionId: params.versionId,
        locale: params.locale,
        slug: params.slug,
        actorStaffId: params.actorStaffId,
        reason: params.reason,
      },
      executor,
    );
  } catch (err) {
    cache = "failed";
    await recordRecoverablePublishFailure(
      { documentId: params.documentId, versionId: params.versionId, kind: "cache", error: err, actorStaffId: params.actorStaffId },
      executor,
    );
  }
  if (params.notify && params.actorStaffId) {
    notify = "ok";
    try {
      await notifyMarketingStakeholders(
        {
          documentId: params.documentId,
          versionId: params.versionId,
          actorStaffId: params.actorStaffId,
          title: params.notify.title,
          body: params.notify.body,
        },
        executor,
      );
    } catch (err) {
      notify = "failed";
      await recordRecoverablePublishFailure(
        { documentId: params.documentId, versionId: params.versionId, kind: "notify", error: err, actorStaffId: params.actorStaffId },
        executor,
      );
    }
  }
  return { cache, notify };
}

/**
 * Retries cache invalidation and/or notification for a version whose publish
 * already committed but whose side effects previously failed. Used by both
 * the reconcile HTTP endpoint and the `marketing_reconcile_publish` job.
 */
export async function reconcilePublish(params: {
  versionId: string;
  kind?: "cache" | "notify" | "all";
  actorStaffId?: string | null;
}): Promise<{ cache?: "ok" | "failed"; notify?: "ok" | "failed" }> {
  const [version] = await db
    .select()
    .from(crmMarketingVersionsTable)
    .where(eq(crmMarketingVersionsTable.id, params.versionId))
    .limit(1);
  if (!version) throw Object.assign(new Error("Version not found"), { status: 404 });
  if (version.status !== "published") {
    throw Object.assign(new Error("Only published versions can be reconciled"), { status: 409 });
  }
  const [slugRow] = await db
    .select({ slug: crmMarketingDocumentsTable.slug })
    .from(crmMarketingDocumentsTable)
    .where(eq(crmMarketingDocumentsTable.id, version.documentId))
    .limit(1);
  const kind = params.kind ?? "all";
  const result: { cache?: "ok" | "failed"; notify?: "ok" | "failed" } = {};
  if (kind === "cache" || kind === "all") {
    try {
      await invalidateMarketingCache({
        documentId: version.documentId,
        versionId: version.id,
        locale: version.locale,
        slug: slugRow?.slug,
        actorStaffId: params.actorStaffId ?? version.publisherStaffId,
        reason: "reconcile",
      });
      result.cache = "ok";
    } catch (err) {
      result.cache = "failed";
      await recordRecoverablePublishFailure({
        documentId: version.documentId,
        versionId: version.id,
        kind: "cache",
        error: err,
        actorStaffId: params.actorStaffId ?? version.publisherStaffId,
      });
    }
  }
  if ((kind === "notify" || kind === "all") && (params.actorStaffId ?? version.publisherStaffId)) {
    try {
      await notifyMarketingStakeholders({
        documentId: version.documentId,
        versionId: version.id,
        actorStaffId: (params.actorStaffId ?? version.publisherStaffId)!,
        title: `Reconciled publish: ${version.title}`,
        body: `Locale ${version.locale} publish side effects were retried.`,
      });
      result.notify = "ok";
    } catch (err) {
      result.notify = "failed";
      await recordRecoverablePublishFailure({
        documentId: version.documentId,
        versionId: version.id,
        kind: "notify",
        error: err,
        actorStaffId: params.actorStaffId ?? version.publisherStaffId,
      });
    }
  }
  return result;
}

/** Recent audit rows recording a recoverable (retryable) publish side-effect failure. */
export async function listRecoverablePublishFailures(versionId: string): Promise<Array<typeof crmMarketingAuditTable.$inferSelect>> {
  return db
    .select()
    .from(crmMarketingAuditTable)
    .where(
      and(
        eq(crmMarketingAuditTable.versionId, versionId),
        inArray(crmMarketingAuditTable.action, ["marketing.cache_invalidate_failed", "marketing.notify_failed"]),
      ),
    )
    .orderBy(desc(crmMarketingAuditTable.createdAt))
    .limit(20);
}
