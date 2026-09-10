import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import {
  db,
  crmTaxonomyTable,
  crmConfigTable,
  crmMeetingsTable,
  crmInquiriesTable,
  crmMessagesTable,
  crmConversationsTable,
  crmContactsTable,
  crmEmailQuarantineTable,
  crmWebhookReceiptsTable,
} from "@workspace/db";
import { and, desc, eq, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ensureCrmSeeded, publicTaxonomyFallback } from "../lib/crm/seed";
import { rateLimitOk, submitInquiry } from "../lib/crm/orchestrator";
import { publicBotProtectionConfig } from "../lib/crm/botAdapter";
import { writeAudit } from "../lib/crm/audit";
import { enqueueJob } from "../lib/crm/jobs";
import {
  graphNotificationAuthorized,
  loadMicrosoftGraphConfig,
  parseGraphNotifications,
  respondGraphValidationToken,
} from "../lib/crm/microsoftGraph";
import { processGraphChangeNotifications } from "../lib/crm/microsoftGraph/inbound";
import { inboundWebhookAuthorized } from "../lib/crm/webhookSecurity";
import { processInboundEmail } from "../lib/crm/inboundEmail";

const router: IRouter = Router();

function extractIp(req: Request): string | undefined {
  return req.ip;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const SubmitBody = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    jobTitle: z.string().trim().min(1).max(120),
    companyName: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(254),
    country: z.string().trim().length(2),
    phoneRaw: z.string().trim().min(4).max(32),
    inquiryType: z.enum(["sales", "general", "technical", "billing", "other"]),
    useCaseKeys: z.array(z.string().min(1).max(64)).max(12).default([]),
    useCaseOther: z.string().trim().max(160).optional(),
    message: z.string().trim().min(10).max(8000),
    answers: z
      .record(
        z.object({
          optionKeys: z.array(z.string().max(64)).max(20).optional(),
          freeText: z.string().max(2000).optional(),
        }),
      )
      .optional(),
    termsAccepted: z.literal(true),
    locale: z.string().max(32).optional(),
    attribution: z.record(z.unknown()).optional(),
    idempotencyKey: z.string().uuid(),
    honeypot: z.string().max(200).optional(),
    botProof: z.string().min(1).max(2048).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.inquiryType === "sales" && data.useCaseKeys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one use case.",
        path: ["useCaseKeys"],
      });
    }
  });

router.get("/contact/bootstrap", async (req, res) => {
  const headerCountry = String(req.headers["cf-ipcountry"] ?? "")
    .toUpperCase()
    .replace("XX", "")
    .replace("T1", "");
  const detected = headerCountry.length === 2 ? headerCountry : null;
  const countries = getCountries()
    .map((code) => ({
      code,
      name: countryName(code),
      callingCode: `+${getCountryCallingCode(code)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let taxonomy = publicTaxonomyFallback();
  let termsVersion = "2026-04-20";
  let privacyPolicyVersion = "2026-04-20";

  try {
    await ensureCrmSeeded();
    const rows = await db
      .select()
      .from(crmTaxonomyTable)
      .where(eq(crmTaxonomyTable.active, true));
    if (rows.length > 0) taxonomy = rows;
    const [policies] = await db
      .select()
      .from(crmConfigTable)
      .where(eq(crmConfigTable.key, "policies"))
      .limit(1);
    termsVersion = (policies?.value as { termsVersion?: string })?.termsVersion ?? termsVersion;
    privacyPolicyVersion =
      (policies?.value as { privacyPolicyVersion?: string })?.privacyPolicyVersion ??
      privacyPolicyVersion;
  } catch (err) {
    logger.warn({ err }, "contact bootstrap falling back to built-in taxonomy");
  }

  const ip = extractIp(req) ?? "unknown";
  try {
    if (await rateLimitOk(`form_view:${ip}`, 1, 10 * 60_000)) {
      await enqueueJob("analytics", { event: "form_view", properties: { source: "bootstrap" } });
    }
  } catch (err) {
    logger.warn({ err }, "form_view analytics skipped");
  }

  res.json({
    countries,
    detectedCountry: detected,
    countryDetectionSource: detected ? "ip" : "none",
    termsVersion,
    privacyPolicyVersion,
    messageMaxLength: 8000,
    taxonomy,
    botProtection: publicBotProtectionConfig(),
  });
});

router.post("/contact/inquiries", async (req, res, next) => {
  const correlationId =
    (req.headers["x-request-id"] as string | undefined) ||
    (req as { id?: string }).id ||
    crypto.randomUUID();
  try {
    const ip = extractIp(req) ?? "unknown";
    const submitMax = Number(process.env.CRM_PUBLIC_SUBMIT_RATE_MAX ?? "8");
    const submitWindowMs = Number(process.env.CRM_PUBLIC_SUBMIT_RATE_WINDOW_MS ?? String(10 * 60_000));
    if (!(await rateLimitOk(`submit:${ip}`, Number.isFinite(submitMax) ? submitMax : 8, Number.isFinite(submitWindowMs) ? submitWindowMs : 10 * 60_000))) {
      res.status(429).json({
        error: "Too many inquiries from this network. Please wait a few minutes and try again.",
        correlationId,
      });
      return;
    }
    const parsed = SubmitBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
        correlationId,
      });
      return;
    }
    const emailKey = parsed.data.email.trim().toLowerCase();
    const emailMax = Number(process.env.CRM_PUBLIC_EMAIL_SUBMIT_RATE_MAX ?? "5");
    const emailWindowMs = Number(process.env.CRM_PUBLIC_EMAIL_SUBMIT_RATE_WINDOW_MS ?? String(60 * 60_000));
    if (
      !(await rateLimitOk(
        `submit:email:${emailKey}`,
        Number.isFinite(emailMax) ? emailMax : 5,
        Number.isFinite(emailWindowMs) ? emailWindowMs : 60 * 60_000,
      ))
    ) {
      res.status(429).json({
        error: "Too many inquiries from this email. Please wait before submitting again.",
        correlationId,
      });
      return;
    }
    const policies = await db
      .select()
      .from(crmConfigTable)
      .where(eq(crmConfigTable.key, "policies"))
      .limit(1);
    const termsVersion =
      (policies[0]?.value as { termsVersion?: string })?.termsVersion ?? "2026-04-20";
    const privacyPolicyVersion =
      (policies[0]?.value as { privacyPolicyVersion?: string })?.privacyPolicyVersion ??
      "2026-04-20";
    const result = await submitInquiry(
      {
        ...parsed.data,
        country: parsed.data.country.toUpperCase(),
        answers: parsed.data.answers ?? {},
        termsVersion,
        privacyPolicyVersion,
      },
      {
        ip,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        hostname: typeof req.hostname === "string" ? req.hostname : undefined,
        correlationId,
      },
    );
    if (result.timing) {
      logger.info(
        {
          correlationId,
          submitTimingMs: result.timing.totalMs,
          submitStages: result.timing.stages,
          pool: result.timing.pool,
        },
        "contact submit stage timing",
      );
      res.setHeader("x-submit-timing-ms", String(result.timing.totalMs));
    }
    res.status(201).json({
      reference: result.reference,
      qualified: result.qualified,
      meetingUrl: result.meetingUrl,
      firstName: result.firstName,
      correlationId,
      ...(result.timing ? { timing: result.timing } : {}),
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 503 || (status && status < 500)) {
      res.status(status).json({
        error: err instanceof Error ? err.message : "We couldn't submit your inquiry.",
        correlationId,
      });
      return;
    }
    logger.error({ err, correlationId }, "contact submit failed");
    res.status(500).json({
      error: "We couldn't submit your inquiry. Your information has been preserved. Please try again.",
      correlationId,
    });
  }
});

router.post("/contact/webhooks/microsoft-graph/mail", async (req, res, next) => {
  try {
    const validationToken = typeof req.query.validationToken === "string" ? req.query.validationToken : undefined;
    if (validationToken) {
      const response = respondGraphValidationToken(validationToken);
      res.status(response.status).type(response.contentType).send(response.body);
      return;
    }
    const config = loadMicrosoftGraphConfig();
    if (!config) {
      if (process.env.NODE_ENV === "production") {
        res.status(503).json({ error: "Microsoft Graph inbound is not configured" });
        return;
      }
      res.status(202).json({ skipped: true, reason: "graph_not_configured" });
      return;
    }
    const notifications = parseGraphNotifications(req.body ?? {});
    const authz = graphNotificationAuthorized(config, notifications);
    if (!authz.ok) {
      res.status(401).json({ error: "Unauthorized", reason: authz.reason });
      return;
    }
    await processGraphChangeNotifications(config, notifications);
    res.status(202).json({ accepted: notifications.length });
  } catch (err) {
    next(err);
  }
});

/** Local/test fixture webhook for direct payload injection (non-production). */
router.post("/contact/webhooks/inbound-email", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      res.status(410).json({ error: "Use /contact/webhooks/microsoft-graph/mail in production" });
      return;
    }
    const authz = inboundWebhookAuthorized({
      nodeEnv: process.env.NODE_ENV,
      secret: process.env.CONTACT_INBOUND_WEBHOOK_SECRET,
      provided: req.headers["x-webhook-secret"],
    });
    if (!authz.ok) {
      res.status(authz.status ?? 401).json({ error: "Unauthorized" });
      return;
    }
    const body = z
      .object({
        from: z.string().email(),
        subject: z.string().max(500).optional(),
        text: z.string().min(1).max(20000),
        html: z.string().max(40000).optional(),
        messageId: z.string().max(200).optional(),
        inReplyTo: z.string().max(200).optional(),
        references: z.string().max(2000).optional(),
        providerEventId: z.string().max(200).optional(),
        eventId: z.string().max(200).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }
    const providerEventId =
      body.data.providerEventId ??
      body.data.eventId ??
      `fixture-${Date.now()}`;
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const result = await processInboundEmail({
      providerEventId: providerEventId ?? `local-${Date.now()}`,
      rawBody,
      payload: {
        from: body.data.from,
        subject: body.data.subject,
        text: body.data.text,
        html: body.data.html,
        messageId: body.data.messageId,
        inReplyTo: body.data.inReplyTo,
        references: body.data.references,
      },
      headers: req.headers as Record<string, string | string[] | undefined>,
    });
    res.status(result.duplicate || result.quarantined ? 202 : 200).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/contact/webhooks/scheduling", async (req, res, next) => {
  try {
    const secret = process.env.CONTACT_SCHEDULING_WEBHOOK_SECRET?.trim();
    if (secret && req.headers["x-webhook-secret"] !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = z
      .object({
        reference: z.string().optional(),
        email: z.string().email().optional(),
        scheduledAt: z.string().datetime().optional(),
        externalBookingId: z.string().optional(),
        status: z.enum(["BOOKED", "CANCELLED", "RESCHEDULED", "NO_SHOW", "COMPLETED"]).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }
    let inquiryId: string | undefined;
    if (body.data.reference) {
      const [inq] = await db
        .select({ id: crmInquiriesTable.id })
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.reference, body.data.reference.toUpperCase()))
        .limit(1);
      inquiryId = inq?.id;
    }
    if (!inquiryId && body.data.email) {
      const [contact] = await db
        .select({ id: crmContactsTable.id })
        .from(crmContactsTable)
        .where(eq(crmContactsTable.emailNormalized, body.data.email.toLowerCase()))
        .limit(1);
      if (contact) {
        const [inq] = await db
          .select({ id: crmInquiriesTable.id })
          .from(crmInquiriesTable)
          .where(eq(crmInquiriesTable.contactId, contact.id))
          .orderBy(desc(crmInquiriesTable.createdAt))
          .limit(1);
        inquiryId = inq?.id;
      }
    }
    if (!inquiryId) {
      res.status(202).json({ matched: false });
      return;
    }
    const [meeting] = await db
      .select()
      .from(crmMeetingsTable)
      .where(eq(crmMeetingsTable.inquiryId, inquiryId))
      .limit(1);
    if (meeting) {
      await db
        .update(crmMeetingsTable)
        .set({
          bookingStatus: body.data.status ?? "BOOKED",
          scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : new Date(),
          externalBookingId: body.data.externalBookingId ?? meeting.externalBookingId,
        })
        .where(eq(crmMeetingsTable.id, meeting.id));
    }
    await writeAudit({
      actorType: "system",
      action: "meeting.booked",
      entityType: "inquiry",
      entityId: inquiryId,
      inquiryId,
    });
    await enqueueJob("analytics", { event: "meeting_booked", inquiryId });
    res.json({ matched: true });
  } catch (err) {
    next(err);
  }
});

router.get("/contact/webhooks/whatsapp", async (req, res, next) => {
  try {
    const { handleConnectorWebhook } = await import("../lib/crm/connectors/http");
    const { whatsappAdapter } = await import("../lib/crm/connectors/whatsapp");
    await handleConnectorWebhook(req, res, whatsappAdapter);
  } catch (err) {
    next(err);
  }
});
router.post("/contact/webhooks/whatsapp", async (req, res, next) => {
  try {
    const { handleConnectorWebhook } = await import("../lib/crm/connectors/http");
    const { whatsappAdapter } = await import("../lib/crm/connectors/whatsapp");
    await handleConnectorWebhook(req, res, whatsappAdapter);
  } catch (err) {
    next(err);
  }
});
router.get("/contact/webhooks/meta", async (req, res, next) => {
  try {
    const { handleConnectorWebhook } = await import("../lib/crm/connectors/http");
    const { messengerAdapter } = await import("../lib/crm/connectors/metaMessaging");
    await handleConnectorWebhook(req, res, messengerAdapter);
  } catch (err) {
    next(err);
  }
});
router.post("/contact/webhooks/meta", async (req, res, next) => {
  try {
    const { handleConnectorWebhook } = await import("../lib/crm/connectors/http");
    const { messengerAdapter, instagramAdapter } = await import("../lib/crm/connectors/metaMessaging");
    const objectName = req.body && typeof req.body === "object" ? String((req.body as { object?: string }).object ?? "page") : "page";
    await handleConnectorWebhook(req, res, objectName === "instagram" ? instagramAdapter : messengerAdapter);
  } catch (err) {
    next(err);
  }
});
router.get("/contact/webhooks/x", async (req, res, next) => {
  try {
    const { handleConnectorWebhook } = await import("../lib/crm/connectors/http");
    const { xAdapter } = await import("../lib/crm/connectors/x");
    await handleConnectorWebhook(req, res, xAdapter);
  } catch (err) {
    next(err);
  }
});
router.post("/contact/webhooks/x", async (req, res, next) => {
  try {
    const { handleConnectorWebhook } = await import("../lib/crm/connectors/http");
    const { xAdapter } = await import("../lib/crm/connectors/x");
    await handleConnectorWebhook(req, res, xAdapter);
  } catch (err) {
    next(err);
  }
});

export default router;
