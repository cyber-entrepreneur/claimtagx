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
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ensureCrmSeeded, publicTaxonomyFallback } from "../lib/crm/seed";
import { rateLimitOk, submitInquiry } from "../lib/crm/orchestrator";
import { writeAudit } from "../lib/crm/audit";
import { enqueueJob } from "../lib/crm/jobs";

const router: IRouter = Router();

function extractIp(req: Request): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]?.trim();
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

  res.json({
    countries,
    detectedCountry: detected,
    countryDetectionSource: detected ? "ip" : "none",
    termsVersion,
    privacyPolicyVersion,
    messageMaxLength: 8000,
    taxonomy,
  });
});

router.post("/contact/inquiries", async (req, res, next) => {
  const correlationId =
    (req.headers["x-request-id"] as string | undefined) ||
    (req as { id?: string }).id ||
    crypto.randomUUID();
  try {
    const ip = extractIp(req) ?? "unknown";
    if (!rateLimitOk(`submit:${ip}`, 8, 10 * 60_000)) {
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
        correlationId,
      },
    );
    res.status(201).json({
      reference: result.reference,
      qualified: result.qualified,
      meetingUrl: result.meetingUrl,
      firstName: result.firstName,
      correlationId,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status && status < 500) {
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

router.post("/contact/webhooks/inbound-email", async (req, res, next) => {
  try {
    const secret = process.env.CONTACT_INBOUND_WEBHOOK_SECRET?.trim();
    if (secret) {
      const provided = req.headers["x-webhook-secret"];
      if (provided !== secret) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    } else if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Inbound email is not configured" });
      return;
    }
    const body = z
      .object({
        from: z.string().email(),
        subject: z.string().max(500).optional(),
        text: z.string().min(1).max(20000),
        messageId: z.string().max(200).optional(),
        inReplyTo: z.string().max(200).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }
    const ref = body.data.subject?.match(/CTX-\d{4}-\d{6}/i)?.[0]?.toUpperCase();
    if (!ref) {
      res.status(202).json({ matched: false });
      return;
    }
    const [inquiry] = await db
      .select()
      .from(crmInquiriesTable)
      .where(eq(crmInquiriesTable.reference, ref))
      .limit(1);
    if (!inquiry) {
      res.status(202).json({ matched: false });
      return;
    }
    const [conversation] = await db
      .select()
      .from(crmConversationsTable)
      .where(eq(crmConversationsTable.inquiryId, inquiry.id))
      .limit(1);
    if (!conversation) {
      res.status(202).json({ matched: false });
      return;
    }
    await db.insert(crmMessagesTable).values({
      conversationId: conversation.id,
      inquiryId: inquiry.id,
      kind: "customer_email_reply",
      visibility: "customer",
      channel: "email",
      authorType: "contact",
      authorContactId: inquiry.contactId,
      subject: body.data.subject ?? null,
      body: body.data.text,
      externalMessageId: body.data.messageId ?? null,
      inReplyTo: body.data.inReplyTo ?? null,
    });
    await db
      .update(crmInquiriesTable)
      .set({
        lastActivityAt: new Date(),
        lastCustomerMessageAt: new Date(),
        status: inquiry.status === "WAITING_FOR_CUSTOMER" ? "IN_PROGRESS" : inquiry.status,
        updatedAt: new Date(),
      })
      .where(eq(crmInquiriesTable.id, inquiry.id));
    await writeAudit({
      actorType: "contact",
      actorId: inquiry.contactId,
      action: "message.received",
      entityType: "inquiry",
      entityId: inquiry.id,
      inquiryId: inquiry.id,
    });
    if (inquiry.assignedStaffId) {
      await enqueueJob("notify_staff", {
        staffId: inquiry.assignedStaffId,
        inquiryId: inquiry.id,
        type: "customer_reply",
        title: "Customer replied",
        body: inquiry.reference,
      });
    }
    res.json({ matched: true, reference: inquiry.reference });
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

export default router;
