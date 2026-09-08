import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, crmAuditEventsTable } from "@workspace/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { boundedPageSize, decodeTimeIdCursor, encodeTimeIdCursor } from "../lib/crm/keysetCursor";
import { requirePermission, requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import { requireAdminRateLimit } from "../lib/crm/adminRateLimit";
import {
  dsarStatusPayload,
  enqueueDsarExport,
  getExport,
} from "../lib/crm/exportJobs";
import {
  anonymizeContact,
  buildCorrectionRequest,
  enforceInquiryRetention,
  placeLegalHold,
  releaseLegalHold,
} from "../lib/crm/governance";
import { writeAudit } from "../lib/crm/audit";
import { enqueueJob } from "../lib/crm/queue";
import { replayWebhookReceipt } from "../lib/crm/inboundEmail";

const router: IRouter = Router();

router.use(requirePlatformAdmin);
router.use(requireAdminRateLimit);

router.post(
  "/platform/contact/governance/dsar-export",
  requirePermission("inquiries.export"),
  async (req, res, next) => {
    try {
      const parsed = z.object({ contactId: z.string().uuid() }).safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "contactId is required" });
        return;
      }
      const job = await enqueueDsarExport({
        staffId: req.platformStaff!.id,
        contactId: parsed.data.contactId,
      });
      res.status(202).json(dsarStatusPayload(job, parsed.data.contactId));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/contacts/:id/dsar-export",
  requirePermission("inquiries.export"),
  async (req, res, next) => {
    try {
      const contactId = String(req.params.id);
      const job = await enqueueDsarExport({
        staffId: req.platformStaff!.id,
        contactId,
      });
      res.status(202).json(dsarStatusPayload(job, contactId));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/platform/contact/dsar-exports/:exportId",
  requirePermission("inquiries.export"),
  async (req, res, next) => {
    try {
      const job = await getExport({
        exportJobId: String(req.params.exportId),
        staffId: req.platformStaff!.id,
      });
      const contactId = String(((job.filters ?? {}) as { contactId?: string }).contactId ?? "");
      res.json(dsarStatusPayload(job, contactId));
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 0;
      if (status >= 400 && status < 600) {
        res.status(status).json({ error: err instanceof Error ? err.message : "Export error" });
        return;
      }
      next(err);
    }
  },
);

router.post(
  "/platform/contact/governance/anonymize",
  requirePermission("inquiries.delete"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          contactId: z.string().uuid(),
          reason: z.string().trim().min(5).max(500),
        })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "contactId and reason are required" });
        return;
      }
      const updated = await anonymizeContact(
        parsed.data.contactId,
        req.platformStaff!.id,
        parsed.data.reason,
      );
      res.json({ id: updated.id, email: updated.email });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/governance/retention-run",
  requirePermission("config.manage"),
  async (req, res, next) => {
    try {
      const count = await enforceInquiryRetention();
      await enqueueJob("analytics", {
        event: "retention_enforced",
        properties: { anonymizedMessageSets: count },
      });
      res.json({ processed: count });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/governance/legal-hold",
  requirePermission("config.manage"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          contactId: z.string().uuid().optional(),
          inquiryId: z.string().uuid().optional(),
          reason: z.string().trim().min(5).max(500),
        })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "reason and contactId or inquiryId are required" });
        return;
      }
      const row = await placeLegalHold({
        ...parsed.data,
        actorStaffId: req.platformStaff!.id,
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/governance/legal-hold/:id/release",
  requirePermission("config.manage"),
  async (req, res, next) => {
    try {
      const row = await releaseLegalHold(String(req.params.id), req.platformStaff!.id);
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/governance/correction",
  requirePermission("inquiries.export"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          contactId: z.string().uuid(),
          fields: z.array(z.string().min(1).max(80)).min(1).max(20),
          reason: z.string().trim().min(5).max(500),
        })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "contactId, fields, and reason are required" });
        return;
      }
      const payload = buildCorrectionRequest(parsed.data);
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "governance.correction_requested",
        entityType: "contact",
        entityId: payload.contactId,
        contactId: payload.contactId,
        afterValue: payload,
      });
      res.status(201).json(payload);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/platform/contact/audit",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const limit = boundedPageSize(req.query.limit, 50, 200);
      const inquiryId = typeof req.query.inquiryId === "string" ? req.query.inquiryId : undefined;
      const cursor = typeof req.query.cursor === "string" ? decodeTimeIdCursor(req.query.cursor) : null;
      const filters = [];
      if (inquiryId) filters.push(eq(crmAuditEventsTable.inquiryId, inquiryId));
      if (cursor) {
        filters.push(
          or(
            lt(crmAuditEventsTable.createdAt, cursor.createdAt),
            and(eq(crmAuditEventsTable.createdAt, cursor.createdAt), lt(crmAuditEventsTable.id, cursor.id)),
          )!,
        );
      }
      const rows = await db
        .select()
        .from(crmAuditEventsTable)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(crmAuditEventsTable.createdAt), desc(crmAuditEventsTable.id))
        .limit(limit);
      const last = rows[rows.length - 1];
      const nextCursor =
        last && rows.length === limit ? encodeTimeIdCursor({ createdAt: last.createdAt, id: last.id }) : null;
      res.json({ items: rows, total: rows.length, limit, nextCursor });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/webhooks/:eventId/replay",
  requirePermission("config.manage"),
  async (req, res, next) => {
    try {
      const result = await replayWebhookReceipt({
        providerEventId: String(req.params.eventId),
        actorStaffId: req.platformStaff!.id,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/platform/contact/webhooks",
  requirePermission("jobs.inspect"),
  async (_req, res, next) => {
    try {
      const { crmWebhookReceiptsTable } = await import("@workspace/db");
      const items = await db.select().from(crmWebhookReceiptsTable).limit(200);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

router.post("/platform/contact/dsar", requirePermission("privacy.dsar"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        contactId: z.string().uuid(),
        requestType: z.enum(["access", "export", "correction", "deletion", "objection"]),
        notes: z.string().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "contactId and requestType are required" });
      return;
    }
    const { createDsarRequest } = await import("../lib/crm/dsar");
    const row = await createDsarRequest({ ...parsed.data, actorStaffId: req.platformStaff!.id });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/dsar", requirePermission("privacy.dsar"), async (_req, res, next) => {
  try {
    const { listDsarRequests } = await import("../lib/crm/dsar");
    res.json({ items: await listDsarRequests() });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/dsar/:id/transition", requirePermission("privacy.dsar"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        status: z.string(),
        identityVerified: z.boolean().optional(),
        legalExceptionReason: z.string().optional(),
        rejectionReason: z.string().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "status is required" });
      return;
    }
    const { transitionDsarRequest } = await import("../lib/crm/dsar");
    const row = await transitionDsarRequest({
      id: String(req.params.id),
      actorStaffId: req.platformStaff!.id,
      ...parsed.data,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/dsar/:id/export", requirePermission("privacy.dsar"), async (req, res, next) => {
  try {
    const { completeDsarExport } = await import("../lib/crm/dsar");
    const result = await completeDsarExport({ id: String(req.params.id), actorStaffId: req.platformStaff!.id });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/dsar/:id/correct", requirePermission("privacy.dsar"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        firstName: z.string().min(1).max(120).optional(),
        lastName: z.string().min(1).max(120).optional(),
        jobTitle: z.string().max(200).optional(),
        email: z.string().email().max(320).optional(),
        phone: z.string().max(40).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid correction patch" });
      return;
    }
    const { applyDsarCorrection } = await import("../lib/crm/dsar");
    const row = await applyDsarCorrection({
      id: String(req.params.id),
      actorStaffId: req.platformStaff!.id,
      patch: parsed.data,
    });
    res.json(row);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      res.status(status).json({ error: err instanceof Error ? err.message : "DSAR correction failed" });
      return;
    }
    next(err);
  }
});

router.post("/platform/contact/dsar/:id/delete", requirePermission("privacy.dsar"), async (req, res, next) => {
  try {
    const { completeDsarDeletion } = await import("../lib/crm/dsar");
    const row = await completeDsarDeletion({ id: String(req.params.id), actorStaffId: req.platformStaff!.id });
    res.json(row);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      res.status(status).json({ error: err instanceof Error ? err.message : "DSAR deletion failed" });
      return;
    }
    next(err);
  }
});

router.post("/platform/contact/dsar/:id/object", requirePermission("privacy.dsar"), async (req, res, next) => {
  try {
    const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;
    const { completeDsarObjection } = await import("../lib/crm/dsar");
    const row = await completeDsarObjection({
      id: String(req.params.id),
      actorStaffId: req.platformStaff!.id,
      notes,
    });
    res.json(row);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      res.status(status).json({ error: err instanceof Error ? err.message : "DSAR objection failed" });
      return;
    }
    next(err);
  }
});

router.get("/platform/contact/attachments", requirePermission("attachments.manage"), async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const { db, crmAttachmentsTable } = await import("@workspace/db");
    const { and, desc, eq, lt, or } = await import("drizzle-orm");
    const { boundedPageSize, decodeTimeIdCursor, encodeTimeIdCursor } = await import("../lib/crm/keysetCursor");
    const limit = boundedPageSize(req.query.limit, 100, 200);
    const cursor = typeof req.query.cursor === "string" ? decodeTimeIdCursor(req.query.cursor) : null;
    const filters = [];
    if (status) filters.push(eq(crmAttachmentsTable.malwareStatus, status));
    if (cursor) {
      filters.push(
        or(
          lt(crmAttachmentsTable.createdAt, cursor.createdAt),
          and(eq(crmAttachmentsTable.createdAt, cursor.createdAt), lt(crmAttachmentsTable.id, cursor.id)),
        )!,
      );
    }
    const rows = await db
      .select()
      .from(crmAttachmentsTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(crmAttachmentsTable.createdAt), desc(crmAttachmentsTable.id))
      .limit(limit);
    const last = rows[rows.length - 1];
    const nextCursor =
      last && rows.length === limit ? encodeTimeIdCursor({ createdAt: last.createdAt, id: last.id }) : null;
    res.json({ attachments: rows, nextCursor, limit });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/attachments", requirePermission("attachments.manage"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        filename: z.string(),
        mimeType: z.string(),
        contentBase64: z.string(),
        inquiryId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        visibility: z.enum(["internal", "customer"]).default("internal"),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid attachment metadata" });
      return;
    }
    const bytes = Buffer.from(parsed.data.contentBase64, "base64");
    const { registerAttachment, signedAttachmentUrl } = await import("../lib/crm/attachmentStore");
    const row = await registerAttachment({
      meta: { filename: parsed.data.filename, mimeType: parsed.data.mimeType, sizeBytes: bytes.length },
      bytes,
      inquiryId: parsed.data.inquiryId,
      contactId: parsed.data.contactId,
      visibility: parsed.data.visibility,
      actorStaffId: req.platformStaff!.id,
    });
    res.status(201).json({ attachment: row, downloadUrl: signedAttachmentUrl(row.id, req.platformStaff!.id) });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/attachments/:id/release-quarantine", requirePermission("attachments.manage"), async (req, res, next) => {
  try {
    const { db, crmAttachmentsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { writeAudit } = await import("../lib/crm/audit");
    const [row] = await db
      .select()
      .from(crmAttachmentsTable)
      .where(eq(crmAttachmentsTable.id, String(req.params.id)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    if (row.malwareStatus !== "quarantined" && row.malwareStatus !== "pending") {
      res.status(409).json({ error: "Attachment is not quarantined" });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "manual release";
    const [updated] = await db
      .update(crmAttachmentsTable)
      .set({ malwareStatus: "clean", malwareReason: `released: ${reason}` })
      .where(eq(crmAttachmentsTable.id, row.id))
      .returning();
    await writeAudit({
      actorType: "staff",
      actorId: req.platformStaff!.id,
      action: "attachment.quarantine_released",
      entityType: "attachment",
      entityId: row.id,
      afterValue: { malwareStatus: "clean", reason },
    });
    res.json({ attachment: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/inquiries/:id/convert-opportunity", requirePermission("opportunities.convert"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        idempotencyKey: z.string().min(8),
        amountCents: z.number().int().optional(),
        currency: z.string().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    const { convertInquiryToOpportunity } = await import("../lib/crm/opportunities");
    const result = await convertInquiryToOpportunity({
      inquiryId: String(req.params.id),
      actorStaffId: req.platformStaff!.id,
      ...parsed.data,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
