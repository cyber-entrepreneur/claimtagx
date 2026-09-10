import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, max, sql } from "drizzle-orm";
import {
  crmMarketingAuditTable,
  crmMarketingDocumentsTable,
  crmMarketingVersionsTable,
  db,
} from "@workspace/db";
import { requirePermission, requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import { requireAdminRateLimit } from "../lib/crm/adminRateLimit";
import {
  assertMarketingTransition,
  compareMarketingVersions,
  validateMarketingPublication,
  type MarketingTransition,
} from "../lib/crm/marketingLifecycle";
import { createRollbackDraft, publishDueScheduledVersions, updateMarketingDraft } from "../lib/crm/marketingCommands";
import { writeAudit } from "../lib/crm/audit";
import { ROLE_PERMISSIONS } from "../lib/crm/rbac";
import { listRecoverablePublishFailures, reconcilePublish } from "../lib/crm/marketingPublishing";

const router: IRouter = Router();
router.use(requirePlatformAdmin);
router.use(requireAdminRateLimit);

const transitionBody = z.object({
  transition: z.enum([
    "submit_review",
    "request_changes",
    "approve",
    "reject",
    "schedule",
    "publish",
    "unpublish",
    "archive",
    "revise",
  ]),
  expectedLockVersion: z.number().int().positive().optional(),
  scheduledAt: z.string().datetime().optional(),
  reason: z.string().min(3).optional(),
});

const draftBody = z.object({
  slug: z.string().min(1),
  locale: z.string().min(2).default("en"),
  title: z.string().min(1),
  summary: z.string().optional(),
  body: z.record(z.unknown()).default({}),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  robots: z.string().optional(),
});

router.get("/platform/marketing/documents", requirePermission("marketing.read"), async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: crmMarketingDocumentsTable.id,
        slug: crmMarketingDocumentsTable.slug,
        contentType: crmMarketingDocumentsTable.contentType,
        updatedAt: crmMarketingDocumentsTable.updatedAt,
      })
      .from(crmMarketingDocumentsTable)
      .orderBy(desc(crmMarketingDocumentsTable.updatedAt));
    res.json({ documents: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/marketing/documents/:slug/versions", requirePermission("marketing.read"), async (req, res, next) => {
  try {
    const [doc] = await db
      .select()
      .from(crmMarketingDocumentsTable)
      .where(eq(crmMarketingDocumentsTable.slug, String(req.params.slug)))
      .limit(1);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const versions = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.documentId, doc.id))
      .orderBy(desc(crmMarketingVersionsTable.version));
    res.json({ document: doc, versions });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/marketing/documents", requirePermission("marketing.propose"), async (req, res, next) => {
  try {
    const body = draftBody.parse(req.body);
    const staffId = req.platformStaff!.id;
    const [doc] = await db
      .insert(crmMarketingDocumentsTable)
      .values({ slug: body.slug, contentType: "page" })
      .onConflictDoNothing({ target: crmMarketingDocumentsTable.slug })
      .returning();
    const [existing] = await db
      .select()
      .from(crmMarketingDocumentsTable)
      .where(eq(crmMarketingDocumentsTable.slug, body.slug))
      .limit(1);
    const document =
      doc ??
      existing;
    if (!document) throw new Error("document create failed");
    const [{ maxVersion }] = await db
      .select({ maxVersion: max(crmMarketingVersionsTable.version) })
      .from(crmMarketingVersionsTable)
      .where(and(eq(crmMarketingVersionsTable.documentId, document.id), eq(crmMarketingVersionsTable.locale, body.locale)));
    const version = Number(maxVersion ?? 0) + 1;
    const [row] = await db
      .insert(crmMarketingVersionsTable)
      .values({
        documentId: document.id,
        locale: body.locale,
        version,
        status: "draft",
        title: body.title,
        summary: body.summary ?? null,
        body: body.body,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        robots: body.robots ?? null,
        authorStaffId: staffId,
      })
      .returning();
    await db.insert(crmMarketingAuditTable).values({
      documentId: document.id,
      versionId: row!.id,
      action: "marketing.create_draft",
      actorStaffId: staffId,
      afterValue: { slug: body.slug, locale: body.locale, version },
    });
    res.status(201).json({ document, version: row });
  } catch (err) {
    next(err);
  }
});

router.patch("/platform/marketing/versions/:id", requirePermission("marketing.propose"), async (req, res, next) => {
  try {
    const body = z
      .object({
        expectedLockVersion: z.number().int().positive(),
        title: z.string().min(1).optional(),
        summary: z.string().nullable().optional(),
        body: z.record(z.unknown()).optional(),
        seoTitle: z.string().nullable().optional(),
        seoDescription: z.string().nullable().optional(),
        robots: z.string().nullable().optional(),
      })
      .parse(req.body);
    const updated = await updateMarketingDraft({
      versionId: String(req.params.id),
      actorStaffId: req.platformStaff!.id,
      ...body,
    });
    res.json({ version: updated });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/marketing/versions/:id", requirePermission("marketing.read"), async (req, res, next) => {
  try {
    const [version] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, String(req.params.id)))
      .limit(1);
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    res.json({ version });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/marketing/versions/:id/preview", requirePermission("marketing.read"), async (req, res, next) => {
  try {
    const [version] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, String(req.params.id)))
      .limit(1);
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    res.json({
      preview: {
        id: version.id,
        status: version.status,
        locale: version.locale,
        title: version.title,
        summary: version.summary,
        body: version.body,
        seoTitle: version.seoTitle,
        seoDescription: version.seoDescription,
        unpublished: version.status !== "published",
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/marketing/versions/:leftId/compare/:rightId", requirePermission("marketing.read"), async (req, res, next) => {
  try {
    const [left] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, String(req.params.leftId)))
      .limit(1);
    const [right] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, String(req.params.rightId)))
      .limit(1);
    if (!left || !right) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    res.json({
      left: { id: left.id, version: left.version, locale: left.locale, status: left.status },
      right: { id: right.id, version: right.version, locale: right.locale, status: right.status },
      diffs: compareMarketingVersions(
        {
          title: left.title,
          summary: left.summary,
          body: (left.body as Record<string, unknown>) ?? {},
          seoTitle: left.seoTitle,
          seoDescription: left.seoDescription,
        },
        {
          title: right.title,
          summary: right.summary,
          body: (right.body as Record<string, unknown>) ?? {},
          seoTitle: right.seoTitle,
          seoDescription: right.seoDescription,
        },
      ),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/marketing/documents/:slug/audit", requirePermission("marketing.read"), async (req, res, next) => {
  try {
    const [doc] = await db
      .select()
      .from(crmMarketingDocumentsTable)
      .where(eq(crmMarketingDocumentsTable.slug, String(req.params.slug)))
      .limit(1);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const audit = await db
      .select()
      .from(crmMarketingAuditTable)
      .where(eq(crmMarketingAuditTable.documentId, doc.id))
      .orderBy(desc(crmMarketingAuditTable.createdAt))
      .limit(200);
    res.json({ document: doc, audit });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/marketing/versions/:id/rollback", requirePermission("marketing.propose"), async (req, res, next) => {
  try {
    const staff = req.platformStaff!;
    const permissions =
      staff.permissions && staff.permissions.length > 0
        ? staff.permissions
        : (ROLE_PERMISSIONS[staff.role] ?? []);
    const draft = await createRollbackDraft({
      versionId: String(req.params.id),
      actorStaffId: staff.id,
      permissions,
    });
    res.status(201).json({ version: draft });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/marketing/versions/:id/transition", async (req, res, next) => {
  try {
    const body = transitionBody.parse(req.body);
    const staff = req.platformStaff!;
    const staffId = staff.id;
    const permissions =
      staff.permissions && staff.permissions.length > 0
        ? staff.permissions
        : (ROLE_PERMISSIONS[staff.role] ?? []);
    const [version] = await db
      .select()
      .from(crmMarketingVersionsTable)
      .where(eq(crmMarketingVersionsTable.id, String(req.params.id)))
      .limit(1);
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    if (body.transition === "publish") {
      const peers = await db
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
        res.status(400).json({ error: "Publication validation failed", issues });
        return;
      }
      for (const prev of peers.filter((p) => p.locale === version.locale)) {
        await db
          .update(crmMarketingVersionsTable)
          .set({ status: "superseded", updatedAt: new Date() })
          .where(eq(crmMarketingVersionsTable.id, prev.id));
      }
    }
    const nextStatus = assertMarketingTransition({
      status: version.status as Parameters<typeof assertMarketingTransition>[0]["status"],
      transition: body.transition as MarketingTransition,
      actorStaffId: staffId,
      authorStaffId: version.authorStaffId,
      reviewerStaffId: version.reviewerStaffId,
      permissions,
      expectedLockVersion: body.expectedLockVersion,
      currentLockVersion: version.lockVersion,
    });
    const [updated] = await db
      .update(crmMarketingVersionsTable)
      .set({
        status: nextStatus,
        lockVersion: sql`${crmMarketingVersionsTable.lockVersion} + 1`,
        reviewerStaffId: body.transition === "approve" ? staffId : version.reviewerStaffId,
        publisherStaffId: body.transition === "publish" ? staffId : version.publisherStaffId,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : version.scheduledAt,
        publishedAt: body.transition === "publish" ? new Date() : version.publishedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(crmMarketingVersionsTable.id, version.id),
          eq(crmMarketingVersionsTable.lockVersion, version.lockVersion),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Version lock mismatch. Refresh and retry." });
      return;
    }
    await db.insert(crmMarketingAuditTable).values({
      documentId: version.documentId,
      versionId: version.id,
      action: `marketing.${body.transition}`,
      actorStaffId: staffId,
      beforeValue: { status: version.status, lockVersion: version.lockVersion },
      afterValue: { status: nextStatus, lockVersion: updated.lockVersion },
      reason: body.reason ?? null,
    });
    await writeAudit({
      actorType: "staff",
      actorId: staffId,
      action: `marketing.${body.transition}`,
      entityType: "marketing_version",
      entityId: version.id,
      afterValue: { status: nextStatus },
    });
    let sideEffects: { cache: "ok" | "failed"; notify: "ok" | "failed" | "skipped" } | undefined;
    if (body.transition === "publish" || body.transition === "unpublish") {
      // The transition above already committed. Cache/notify failures must
      // never roll back or block the (un)publish — they are recorded as
      // retryable audit entries + a reconcile job (see reconcile-publish).
      const { applyPostPublishSideEffects } = await import("../lib/crm/marketingPublishing");
      sideEffects = await applyPostPublishSideEffects({
        documentId: version.documentId,
        versionId: version.id,
        locale: version.locale,
        slug: (
          await db
            .select({ slug: crmMarketingDocumentsTable.slug })
            .from(crmMarketingDocumentsTable)
            .where(eq(crmMarketingDocumentsTable.id, version.documentId))
            .limit(1)
        )[0]?.slug,
        actorStaffId: staffId,
        reason: body.transition,
        notify: { title: `Marketing ${body.transition}: ${version.title}`, body: `Locale ${version.locale} is now ${nextStatus}.` },
      });
    }
    res.json({ version: updated, sideEffects });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/platform/marketing/versions/:id/publish-failures",
  requirePermission("marketing.read"),
  async (req, res, next) => {
    try {
      const failures = await listRecoverablePublishFailures(String(req.params.id));
      res.json({ failures });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/marketing/versions/:id/reconcile-publish",
  requirePermission("marketing.publish"),
  async (req, res, next) => {
    try {
      const parsed = z.object({ kind: z.enum(["cache", "notify", "all"]).default("all") }).safeParse(req.body ?? {});
      const result = await reconcilePublish({
        versionId: String(req.params.id),
        kind: parsed.success ? parsed.data.kind : "all",
        actorStaffId: req.platformStaff!.id,
      });
      res.json({ result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
