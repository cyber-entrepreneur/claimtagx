import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, crmJobEffectsTable } from "@workspace/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { boundedPageSize, decodeTimeIdCursor, encodeTimeIdCursor } from "../lib/crm/keysetCursor";
import { requirePermission, requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import { requireAdminRateLimit } from "../lib/crm/adminRateLimit";
import {
  effectMetrics,
  loadEffect,
  reconcileUncertainEmail,
  replayTerminalEffect,
} from "../lib/crm/effects";
import { writeAudit } from "../lib/crm/audit";

const router: IRouter = Router();

router.use(requirePlatformAdmin);
router.use(requireAdminRateLimit);

router.get("/platform/contact/effects", requirePermission("jobs.inspect"), async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = boundedPageSize(req.query.limit, 50, 200);
    const cursor = typeof req.query.cursor === "string" ? decodeTimeIdCursor(req.query.cursor) : null;
    const filters = [];
    if (status) filters.push(eq(crmJobEffectsTable.status, status));
    if (cursor) {
      filters.push(
        or(
          lt(crmJobEffectsTable.createdAt, cursor.createdAt),
          and(
            eq(crmJobEffectsTable.createdAt, cursor.createdAt),
            lt(crmJobEffectsTable.idempotencyKey, cursor.id),
          ),
        )!,
      );
    }
    const rows = await db
      .select({
        key: crmJobEffectsTable.idempotencyKey,
        kind: crmJobEffectsTable.kind,
        status: crmJobEffectsTable.status,
        attempts: crmJobEffectsTable.attempts,
        lastError: crmJobEffectsTable.lastError,
        jobId: crmJobEffectsTable.jobId,
        providerMessageId: crmJobEffectsTable.providerMessageId,
        createdAt: crmJobEffectsTable.createdAt,
        nextAttemptAt: crmJobEffectsTable.nextAttemptAt,
      })
      .from(crmJobEffectsTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(crmJobEffectsTable.createdAt), desc(crmJobEffectsTable.idempotencyKey))
      .limit(limit);
    const last = rows[rows.length - 1];
    const nextCursor =
      last && rows.length === limit
        ? encodeTimeIdCursor({ createdAt: last.createdAt, id: last.key })
        : null;
    res.json({ effects: rows, metrics: effectMetrics, nextCursor, limit });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/effects/:key", requirePermission("jobs.inspect"), async (req, res, next) => {
  try {
    const row = await loadEffect(String(req.params.key));
    if (!row) {
      res.status(404).json({ error: "Effect not found" });
      return;
    }
    res.json({ effect: row });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/platform/contact/effects/:key/reconcile",
  requirePermission("jobs.replay"),
  async (req, res, next) => {
    try {
      const outcome = await reconcileUncertainEmail(String(req.params.key));
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "effect.reconcile",
        entityType: "effect",
        entityId: String(req.params.key),
        afterValue: { outcome },
      });
      res.json({ key: req.params.key, outcome });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/effects/:key/replay",
  requirePermission("jobs.replay"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          reason: z.string().trim().min(5).max(500),
          allowUncertain: z.boolean().optional(),
        })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "reason (5–500 chars) is required" });
        return;
      }
      const ok = await replayTerminalEffect({
        key: String(req.params.key),
        actorStaffId: req.platformStaff!.id,
        reason: parsed.data.reason,
        allowUncertain: parsed.data.allowUncertain,
      });
      if (!ok) {
        res.status(404).json({ error: "Effect not found or not replayable" });
        return;
      }
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "effect.replay",
        entityType: "effect",
        entityId: String(req.params.key),
        afterValue: { reason: parsed.data.reason, allowUncertain: parsed.data.allowUncertain ?? false },
      });
      res.json({ key: req.params.key, status: "pending" });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
