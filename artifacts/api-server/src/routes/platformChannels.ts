import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, crmChannelIdentitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePermission, requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import { listChannelHealth, persistChannelHealthSnapshot, connectorObservability, quarantineOpenCount } from "../lib/crm/connectors/health";
import { staffLinkIdentity, staffUnlinkIdentity } from "../lib/crm/connectors/identity";
import { LINKEDIN_HANDOFF_URL, TIKTOK_HANDOFF_URL } from "../lib/crm/connectors/registry";

const router: IRouter = Router();
router.use("/platform", requirePlatformAdmin);

router.get("/platform/contact/channels", requirePermission("inquiries.view"), async (_req, res, next) => {
  try {
    const channels = await listChannelHealth();
    res.json({
      channels,
      metrics: connectorObservability(),
      quarantineOpenCount: await quarantineOpenCount(),
      handoff: { tiktok: TIKTOK_HANDOFF_URL, linkedin: LINKEDIN_HANDOFF_URL },
      note: "Simulator and fixture controls are never live. LIVE_VERIFIED requires classified real-provider evidence.",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/channels/health-check", requirePermission("channels.manage"), async (_req, res, next) => {
  try {
    await persistChannelHealthSnapshot();
    const channels = await listChannelHealth();
    res.json({ channels });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/identities", requirePermission("inquiries.view"), async (req, res, next) => {
  try {
    const contactId = typeof req.query.contactId === "string" ? req.query.contactId : "";
    if (!contactId) {
      res.status(400).json({ error: "contactId required" });
      return;
    }
    const rows = await db
      .select()
      .from(crmChannelIdentitiesTable)
      .where(eq(crmChannelIdentitiesTable.contactId, contactId));
    res.json({ identities: rows });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/identities/:id/link", requirePermission("inquiries.assign"), async (req, res, next) => {
  try {
    const parsed = z.object({ contactId: z.string().uuid() }).parse(req.body ?? {});
    await staffLinkIdentity({
      identityId: String(req.params.id),
      contactId: parsed.contactId,
      actorStaffId: req.platformStaff!.id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/identities/:id/unlink", requirePermission("inquiries.assign"), async (req, res, next) => {
  try {
    await staffUnlinkIdentity({ identityId: String(req.params.id), actorStaffId: req.platformStaff!.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/platform/contact/messages/:id/retry",
  requirePermission("inquiries.reply"),
  async (req, res, next) => {
    try {
      const { retryOutboundMessage } = await import("../lib/crm/connectors/outbound");
      const { db, crmMessagesTable, crmInquiriesTable } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      const { assertInquiryAccess } = await import("../lib/crm/objectAuth");
      const [msg] = await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.id, String(req.params.id))).limit(1);
      if (!msg) {
        res.status(404).json({ error: "Message not found" });
        return;
      }
      const [inquiry] = await db.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.id, msg.inquiryId)).limit(1);
      if (!inquiry) {
        res.status(404).json({ error: "Inquiry not found" });
        return;
      }
      assertInquiryAccess(req.platformStaff!, inquiry, "mutate");
      const result = await retryOutboundMessage({ messageId: msg.id, staffId: req.platformStaff!.id });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
