import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { db, crmConfigChangesTable } from "@workspace/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { boundedPageSize, decodeTimeIdCursor, encodeTimeIdCursor } from "../lib/crm/keysetCursor";
import { requirePermission, requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import { requireAdminRateLimit } from "../lib/crm/adminRateLimit";
import { applyConfigChangeAction } from "../lib/crm/configTransition";
import { createGovernedDraft } from "../lib/crm/configChangeCommands";
import { permissionForEvent, type ConfigChangeEvent } from "../lib/crm/configLifecycle";
import { ROLE_PERMISSIONS, hasPermission, type PlatformPermission } from "../lib/crm/rbac";

const router: IRouter = Router();
router.use("/platform", requirePlatformAdmin);
router.use("/platform", requireAdminRateLimit);

function pid(req: Request, name = "id"): string {
  const v = req.params[name];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

router.get("/platform/contact/config/changes", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
    const limit = boundedPageSize(req.query.limit, 100, 200);
    const cursor = typeof req.query.cursor === "string" ? decodeTimeIdCursor(req.query.cursor) : null;
    const filters = [];
    if (entityType) filters.push(eq(crmConfigChangesTable.entityType, entityType));
    if (cursor) {
      filters.push(
        or(
          lt(crmConfigChangesTable.createdAt, cursor.createdAt),
          and(eq(crmConfigChangesTable.createdAt, cursor.createdAt), lt(crmConfigChangesTable.id, cursor.id)),
        )!,
      );
    }
    const rows = await db
      .select()
      .from(crmConfigChangesTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(crmConfigChangesTable.createdAt), desc(crmConfigChangesTable.id))
      .limit(limit);
    const last = rows[rows.length - 1];
    const nextCursor =
      last && rows.length === limit ? encodeTimeIdCursor({ createdAt: last.createdAt, id: last.id }) : null;
    res.json({ items: rows, nextCursor, limit });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/config/changes", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        entityType: z.string().min(2).max(80),
        entityId: z.string().min(1).max(80),
        afterValue: z.record(z.unknown()),
        beforeValue: z.record(z.unknown()).nullable().optional(),
        effectiveAt: z.string().datetime().optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const row = await createGovernedDraft({
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      afterValue: parsed.afterValue,
      beforeValue: parsed.beforeValue ?? null,
      authorStaffId: req.platformStaff!.id,
      rationale: parsed.rationale,
      correlationId: req.headers["x-request-id"] as string | undefined,
      effectiveAt: parsed.effectiveAt ? new Date(parsed.effectiveAt) : null,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/platform/contact/config/changes/:id/:action",
  requirePermission("config.propose"),
  async (req, res, next) => {
    try {
      const action = pid(req, "action") as ConfigChangeEvent;
      if (!["submit_review", "approve", "reject", "publish", "rollback", "revise"].includes(action)) {
        res.status(400).json({ error: "Unknown action" });
        return;
      }
      const staff = req.platformStaff!;
      const granted =
        staff.permissions?.length ? staff.permissions : (ROLE_PERMISSIONS[staff.role] ?? []);
      const needed = permissionForEvent(action);
      if (!hasPermission(granted, needed as PlatformPermission)) {
        res.status(403).json({ error: `Missing ${needed}` });
        return;
      }
      const body = z
        .object({
          expectedLockVersion: z.number().int(),
          expectedPublishedVersion: z.number().int().optional(),
          rationale: z.string().max(500).optional(),
          emergencyBypass: z.boolean().optional(),
          emergencyReason: z.string().max(500).optional(),
        })
        .parse(req.body ?? {});
      if ((action === "publish" || action === "rollback") && typeof body.expectedPublishedVersion !== "number") {
        res.status(400).json({ error: "expectedPublishedVersion is required" });
        return;
      }
      const { change } = await applyConfigChangeAction({
        changeId: pid(req),
        action,
        actor: { id: staff.id, role: staff.role, permissions: granted },
        expectedLockVersion: body.expectedLockVersion,
        expectedPublishedVersion: body.expectedPublishedVersion,
        rationale: body.rationale,
        emergencyBypass: body.emergencyBypass,
        emergencyReason: body.emergencyReason,
        correlationId: req.headers["x-request-id"] as string | undefined,
      });
      res.json(change);
    } catch (err) {
      if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 409) {
        const conflict = err as unknown as {
          message: string;
          currentLockVersion?: number;
          currentStatus?: string;
          currentPublishedVersion?: number | null;
        };
        res.status(409).json({
          error: conflict.message,
          code: "STALE_LOCK",
          currentLockVersion: conflict.currentLockVersion ?? null,
          currentStatus: conflict.currentStatus ?? null,
          currentPublishedVersion: conflict.currentPublishedVersion ?? null,
        });
        return;
      }
      next(err);
    }
  },
);

export default router;
