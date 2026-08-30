import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import {
  db,
  crmInquiriesTable,
  crmContactsTable,
  crmCompaniesTable,
  crmMessagesTable,
  crmConversationsTable,
  crmInquiryAnswersTable,
  crmQualificationResultsTable,
  crmAuditEventsTable,
  crmInquiryReadsTable,
  crmStaffTable,
  crmTeamsTable,
  crmTemplatesTable,
  crmTemplateVersionsTable,
  crmWorkflowsTable,
  crmRoutingRulesTable,
  crmSlaPoliciesTable,
  crmSlaInstancesTable,
  crmMeetingTypesTable,
  crmMeetingsTable,
  crmNotificationsTable,
  crmSavedViewsTable,
  crmTaxonomyTable,
  crmQualificationModelsTable,
  crmMacrosTable,
  crmTagsTable,
  crmInquiryTagsTable,
  crmAnalyticsEventsTable,
  crmAiClassificationsTable,
  crmWorkflowExecutionsTable,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  clearStaffSessionCookie,
  requirePermission,
  requirePlatformAdmin,
  setStaffSessionCookie,
  upsertStaffFromIdentity,
} from "../middlewares/requirePlatformAdmin";
import { ensureCrmSeeded } from "../lib/crm/seed";
import { writeAudit } from "../lib/crm/audit";
import {
  generateMeetingInvitation,
  sendInquiryEmail,
  addTag,
  loadInquiryContext,
  mergeVarsFor,
} from "../lib/crm/jobs";
import { renderTemplate, textToHtml } from "../lib/crm/templates";
import { sendTransactionalEmail } from "../lib/email";

const router: IRouter = Router();

function pid(req: Request, name = "id"): string {
  const v = req.params[name];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

router.post("/platform/auth/login", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        email: z.string().email(),
        accessKey: z.string().min(8).max(200),
        name: z.string().max(120).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Email and access key are required." });
      return;
    }
    const expected = process.env.PLATFORM_STAFF_ACCESS_KEY?.trim();
    if (!expected || parsed.data.accessKey !== expected) {
      res.status(401).json({ error: "Invalid access key." });
      return;
    }
    await ensureCrmSeeded();
    const staff = await upsertStaffFromIdentity({
      email: parsed.data.email,
      name: parsed.data.name || parsed.data.email.split("@")[0],
    });
    if (!staff) {
      res.status(403).json({ error: "This email is not authorized for Platform Admin." });
      return;
    }
    setStaffSessionCookie(res, staff);
    res.json({
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      permissions: staff.permissions,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/auth/logout", (req, res) => {
  clearStaffSessionCookie(res);
  res.status(204).end();
});

router.use("/platform", requirePlatformAdmin);
router.use("/platform", async (_req, _res, next) => {
  try {
    await ensureCrmSeeded();
    next();
  } catch (err) {
    next(err);
  }
});

router.get("/platform/me", (req, res) => {
  const s = req.platformStaff!;
  res.json({
    id: s.id,
    email: s.email,
    name: s.name,
    role: s.role,
    permissions: s.permissions,
  });
});

router.get("/platform/contact/staff", requirePermission("inquiries.view"), async (_req, res, next) => {
  try {
    const staff = await db.select().from(crmStaffTable);
    const teams = await db.select().from(crmTeamsTable);
    res.json({ staff, teams });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/platform/contact/inquiries",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const staff = req.platformStaff!;
      const q = req.query;
      const limit = Math.min(Number(q.limit ?? 50) || 50, 100);
      const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
      const sort = String(q.sort ?? "createdAt");
      const dir = String(q.dir ?? "desc") === "asc" ? "asc" : "desc";
      const filters: SQL[] = [];

      if (typeof q.status === "string" && q.status) filters.push(eq(crmInquiriesTable.status, q.status));
      if (typeof q.qualificationStatus === "string" && q.qualificationStatus) {
        filters.push(eq(crmInquiriesTable.qualificationStatus, q.qualificationStatus));
      }
      if (typeof q.country === "string" && q.country) {
        filters.push(eq(crmContactsTable.country, q.country.toUpperCase()));
      }
      if (typeof q.assignedStaffId === "string" && q.assignedStaffId) {
        filters.push(eq(crmInquiriesTable.assignedStaffId, q.assignedStaffId));
      }
      if (typeof q.source === "string" && q.source) filters.push(eq(crmInquiriesTable.source, q.source));
      if (typeof q.from === "string") filters.push(gte(crmInquiriesTable.createdAt, new Date(q.from)));
      if (typeof q.to === "string") filters.push(lte(crmInquiriesTable.createdAt, new Date(q.to)));
      if (typeof q.search === "string" && q.search.trim()) {
        const s = `%${q.search.trim()}%`;
        filters.push(
          or(
            ilike(crmContactsTable.firstName, s),
            ilike(crmContactsTable.lastName, s),
            ilike(crmContactsTable.email, s),
            ilike(crmContactsTable.phoneE164, s),
            ilike(crmCompaniesTable.name, s),
            ilike(crmInquiriesTable.reference, s),
          )!,
        );
      }

      const where = filters.length ? and(...filters) : undefined;
      const sortCol =
        sort === "score"
          ? crmInquiriesTable.qualificationScore
          : sort === "lastActivityAt"
            ? crmInquiriesTable.lastActivityAt
            : crmInquiriesTable.createdAt;

      const rows = await db
        .select({
          inquiry: crmInquiriesTable,
          contact: crmContactsTable,
          company: crmCompaniesTable,
          assignee: crmStaffTable,
          readAt: crmInquiryReadsTable.lastReadAt,
        })
        .from(crmInquiriesTable)
        .innerJoin(crmContactsTable, eq(crmContactsTable.id, crmInquiriesTable.contactId))
        .leftJoin(crmCompaniesTable, eq(crmCompaniesTable.id, crmInquiriesTable.companyId))
        .leftJoin(crmStaffTable, eq(crmStaffTable.id, crmInquiriesTable.assignedStaffId))
        .leftJoin(
          crmInquiryReadsTable,
          and(
            eq(crmInquiryReadsTable.inquiryId, crmInquiriesTable.id),
            eq(crmInquiryReadsTable.staffId, staff.id),
          ),
        )
        .where(where)
        .orderBy(dir === "asc" ? sortCol : desc(sortCol))
        .limit(limit)
        .offset(offset);

      let slaRows: Array<typeof crmSlaInstancesTable.$inferSelect> = [];
      if (rows.length) {
        slaRows = await db
          .select()
          .from(crmSlaInstancesTable)
          .where(
            inArray(
              crmSlaInstancesTable.inquiryId,
              rows.map((r) => r.inquiry.id),
            ),
          );
      }
      const slaByInquiry = new Map<string, (typeof slaRows)[number]>();
      for (const sla of slaRows) {
        if (sla.measure === "first_response") slaByInquiry.set(sla.inquiryId, sla);
      }

      const items = rows
        .map((r) => {
          const unread =
            !r.readAt ||
            (r.inquiry.lastCustomerMessageAt &&
              r.readAt.getTime() < r.inquiry.lastCustomerMessageAt.getTime()) ||
            (!r.inquiry.lastCustomerMessageAt && r.readAt.getTime() < r.inquiry.createdAt.getTime());
          if (q.readState === "unread" && !unread) return null;
          if (q.readState === "read" && unread) return null;
          const sla = slaByInquiry.get(r.inquiry.id);
          return {
            id: r.inquiry.id,
            reference: r.inquiry.reference,
            createdAt: r.inquiry.createdAt.toISOString(),
            lastActivityAt: r.inquiry.lastActivityAt.toISOString(),
            firstName: r.contact.firstName,
            lastName: r.contact.lastName,
            company: r.company?.name ?? "",
            jobTitle: r.contact.jobTitle,
            country: r.contact.country,
            useCase: r.inquiry.useCaseKeys,
            qualificationStatus: r.inquiry.qualificationStatus,
            leadScore: r.inquiry.qualificationScore,
            assignedTo: r.assignee?.name ?? null,
            assignedStaffId: r.inquiry.assignedStaffId,
            status: r.inquiry.status,
            unread,
            slaStatus: sla?.status ?? null,
            slaDueAt: sla?.dueAt?.toISOString() ?? null,
            hasMeeting: false,
          };
        })
        .filter(Boolean);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmInquiriesTable)
        .innerJoin(crmContactsTable, eq(crmContactsTable.id, crmInquiriesTable.contactId))
        .leftJoin(crmCompaniesTable, eq(crmCompaniesTable.id, crmInquiriesTable.companyId))
        .where(where);

      res.json({ items, total: count, limit, offset });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/platform/contact/inquiries/:id",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const id = pid(req);
      const staff = req.platformStaff!;
      const [inquiry] = await db
        .select()
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.id, id))
        .limit(1);
      if (!inquiry) {
        res.status(404).json({ error: "Inquiry not found" });
        return;
      }
      const [contact] = await db
        .select()
        .from(crmContactsTable)
        .where(eq(crmContactsTable.id, inquiry.contactId))
        .limit(1);
      const [company] = inquiry.companyId
        ? await db.select().from(crmCompaniesTable).where(eq(crmCompaniesTable.id, inquiry.companyId)).limit(1)
        : [null];
      const [assignee] = inquiry.assignedStaffId
        ? await db.select().from(crmStaffTable).where(eq(crmStaffTable.id, inquiry.assignedStaffId)).limit(1)
        : [null];
      const messages = await db
        .select()
        .from(crmMessagesTable)
        .where(eq(crmMessagesTable.inquiryId, id))
        .orderBy(crmMessagesTable.createdAt);
      const answers = await db
        .select()
        .from(crmInquiryAnswersTable)
        .where(eq(crmInquiryAnswersTable.inquiryId, id));
      const qual = await db
        .select()
        .from(crmQualificationResultsTable)
        .where(eq(crmQualificationResultsTable.inquiryId, id))
        .orderBy(desc(crmQualificationResultsTable.createdAt))
        .limit(5);
      const audit = await db
        .select()
        .from(crmAuditEventsTable)
        .where(eq(crmAuditEventsTable.inquiryId, id))
        .orderBy(desc(crmAuditEventsTable.createdAt))
        .limit(80);
      const sla = await db
        .select()
        .from(crmSlaInstancesTable)
        .where(eq(crmSlaInstancesTable.inquiryId, id));
      const meetings = await db
        .select()
        .from(crmMeetingsTable)
        .where(eq(crmMeetingsTable.inquiryId, id));
      const ai = await db
        .select()
        .from(crmAiClassificationsTable)
        .where(eq(crmAiClassificationsTable.inquiryId, id))
        .orderBy(desc(crmAiClassificationsTable.createdAt))
        .limit(3);
      const executions = await db
        .select()
        .from(crmWorkflowExecutionsTable)
        .where(eq(crmWorkflowExecutionsTable.inquiryId, id))
        .orderBy(desc(crmWorkflowExecutionsTable.createdAt));
      const tags = await db
        .select({ slug: crmTagsTable.slug, label: crmTagsTable.label, id: crmTagsTable.id })
        .from(crmInquiryTagsTable)
        .innerJoin(crmTagsTable, eq(crmTagsTable.id, crmInquiryTagsTable.tagId))
        .where(eq(crmInquiryTagsTable.inquiryId, id));

      await db
        .insert(crmInquiryReadsTable)
        .values({ inquiryId: id, staffId: staff.id, lastReadAt: new Date() })
        .onConflictDoUpdate({
          target: [crmInquiryReadsTable.inquiryId, crmInquiryReadsTable.staffId],
          set: { lastReadAt: new Date() },
        });
      await writeAudit({
        actorType: "staff",
        actorId: staff.id,
        action: "inquiry.opened",
        entityType: "inquiry",
        entityId: id,
        inquiryId: id,
      });

      const visibleMessages = messages.filter((m) => m.visibility === "customer" || m.visibility === "internal");
      res.json({
        inquiry,
        contact,
        company,
        assignee,
        messages: visibleMessages,
        answers,
        qualification: qual,
        audit,
        sla,
        meetings,
        ai,
        executions,
        tags,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/read",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const unread = Boolean((req.body as { unread?: boolean })?.unread);
      if (unread) {
        await db
          .delete(crmInquiryReadsTable)
          .where(
            and(
              eq(crmInquiryReadsTable.inquiryId, pid(req)),
              eq(crmInquiryReadsTable.staffId, req.platformStaff!.id),
            ),
          );
      } else {
        await db
          .insert(crmInquiryReadsTable)
          .values({
            inquiryId: pid(req),
            staffId: req.platformStaff!.id,
            lastReadAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [crmInquiryReadsTable.inquiryId, crmInquiryReadsTable.staffId],
            set: { lastReadAt: new Date() },
          });
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/bulk-read",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({ ids: z.array(z.string().uuid()).min(1).max(100), unread: z.boolean().optional() })
        .parse(req.body ?? {});
      for (const id of parsed.ids) {
        if (parsed.unread) {
          await db
            .delete(crmInquiryReadsTable)
            .where(
              and(
                eq(crmInquiryReadsTable.inquiryId, id),
                eq(crmInquiryReadsTable.staffId, req.platformStaff!.id),
              ),
            );
        } else {
          await db
            .insert(crmInquiryReadsTable)
            .values({ inquiryId: id, staffId: req.platformStaff!.id, lastReadAt: new Date() })
            .onConflictDoNothing();
        }
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/reply",
  requirePermission("inquiries.reply"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          body: z.string().trim().min(1).max(8000),
          templateKey: z.string().optional(),
        })
        .parse(req.body ?? {});
      const [inquiry] = await db
        .select()
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.id, pid(req)))
        .limit(1);
      if (!inquiry) {
        res.status(404).json({ error: "Inquiry not found" });
        return;
      }
      const [conversation] = await db
        .select()
        .from(crmConversationsTable)
        .where(eq(crmConversationsTable.inquiryId, inquiry.id))
        .limit(1);
      const ctx = await loadInquiryContext(inquiry.id);
      const vars = ctx ? mergeVarsFor(ctx) : {};
      (vars as { body?: string }).body = parsed.body;
      let subject = `Re: ClaimTagX Inquiry ${inquiry.reference}`;
      let body = parsed.body;
      if (parsed.templateKey) {
        const [tpl] = await db
          .select()
          .from(crmTemplatesTable)
          .where(eq(crmTemplatesTable.key, parsed.templateKey))
          .limit(1);
        if (tpl) {
          const [ver] = await db
            .select()
            .from(crmTemplateVersionsTable)
            .where(eq(crmTemplateVersionsTable.templateId, tpl.id))
            .orderBy(desc(crmTemplateVersionsTable.versionNumber))
            .limit(1);
          if (ver) {
            subject = renderTemplate(ver.subject, vars as never).text;
            body = renderTemplate(ver.body, vars as never).text;
          }
        }
      }
      const [contact] = await db
        .select()
        .from(crmContactsTable)
        .where(eq(crmContactsTable.id, inquiry.contactId))
        .limit(1);
      if (contact) {
        await sendTransactionalEmail({
          to: contact.email,
          subject,
          text: body,
          html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:24px">${textToHtml(body)}</div>`,
        });
      }
      const [msg] = await db
        .insert(crmMessagesTable)
        .values({
          conversationId: conversation!.id,
          inquiryId: inquiry.id,
          kind: "staff_reply",
          visibility: "customer",
          channel: "email",
          authorType: "staff",
          authorStaffId: req.platformStaff!.id,
          subject,
          body,
          bodyHtml: textToHtml(body),
        })
        .returning();
      const firstResponse = inquiry.firstResponseAt ?? new Date();
      await db
        .update(crmInquiriesTable)
        .set({
          lastActivityAt: new Date(),
          firstResponseAt: firstResponse,
          status: "WAITING_FOR_CUSTOMER",
          updatedAt: new Date(),
        })
        .where(eq(crmInquiriesTable.id, inquiry.id));
      if (!inquiry.firstResponseAt) {
        await db
          .update(crmSlaInstancesTable)
          .set({ status: "COMPLETED", completedAt: new Date() })
          .where(
            and(
              eq(crmSlaInstancesTable.inquiryId, inquiry.id),
              eq(crmSlaInstancesTable.measure, "first_response"),
            ),
          );
      }
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "message.replied",
        entityType: "inquiry",
        entityId: inquiry.id,
        inquiryId: inquiry.id,
      });
      res.status(201).json(msg);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/notes",
  requirePermission("inquiries.note"),
  async (req, res, next) => {
    try {
      const parsed = z.object({ body: z.string().trim().min(1).max(8000) }).parse(req.body ?? {});
      const [conversation] = await db
        .select()
        .from(crmConversationsTable)
        .where(eq(crmConversationsTable.inquiryId, pid(req)))
        .limit(1);
      const mentionEmails = [...parsed.body.matchAll(/@([^\s,]+)/g)].map((m) => m[1]);
      const staff = mentionEmails.length
        ? await db.select().from(crmStaffTable)
        : [];
      const mentions = staff
        .filter((s) =>
          mentionEmails.some(
            (m) =>
              s.emailNormalized.includes(m.toLowerCase()) ||
              s.name.toLowerCase().includes(m.toLowerCase()),
          ),
        )
        .map((s) => s.id);
      const [msg] = await db
        .insert(crmMessagesTable)
        .values({
          conversationId: conversation!.id,
          inquiryId: pid(req),
          kind: "internal_note",
          visibility: "internal",
          channel: "internal",
          authorType: "staff",
          authorStaffId: req.platformStaff!.id,
          body: parsed.body,
          mentions,
        })
        .returning();
      for (const id of mentions) {
        await db.insert(crmNotificationsTable).values({
          staffId: id,
          inquiryId: pid(req),
          type: "mention",
          title: `${req.platformStaff!.name} mentioned you`,
          body: parsed.body.slice(0, 180),
        });
      }
      await db
        .update(crmInquiriesTable)
        .set({ lastActivityAt: new Date(), updatedAt: new Date() })
        .where(eq(crmInquiriesTable.id, pid(req)));
      res.status(201).json(msg);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/forward",
  requirePermission("inquiries.forward"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({ to: z.string().email(), note: z.string().max(2000).optional() })
        .parse(req.body ?? {});
      const ctx = await loadInquiryContext(pid(req));
      if (!ctx) {
        res.status(404).json({ error: "Inquiry not found" });
        return;
      }
      const messages = await db
        .select()
        .from(crmMessagesTable)
        .where(
          and(
            eq(crmMessagesTable.inquiryId, pid(req)),
            eq(crmMessagesTable.visibility, "customer"),
          ),
        )
        .orderBy(crmMessagesTable.createdAt);
      const digest = messages
        .map((m) => `[${m.createdAt.toISOString()}] ${m.authorType}: ${m.body}`)
        .join("\n\n");
      await sendTransactionalEmail({
        to: parsed.to,
        subject: `Fwd: ClaimTagX Inquiry ${ctx.inquiry.reference}`,
        text: `${parsed.note ?? ""}\n\n--- Original conversation ---\n${digest}`,
        html: textToHtml(`${parsed.note ?? ""}\n\n--- Original conversation ---\n${digest}`),
      });
      const [conversation] = await db
        .select()
        .from(crmConversationsTable)
        .where(eq(crmConversationsTable.inquiryId, pid(req)))
        .limit(1);
      await db.insert(crmMessagesTable).values({
        conversationId: conversation!.id,
        inquiryId: pid(req),
        kind: "forward",
        visibility: "internal",
        channel: "email",
        authorType: "staff",
        authorStaffId: req.platformStaff!.id,
        body: parsed.note || `Forwarded to ${parsed.to}`,
        forwardedTo: parsed.to,
      });
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "message.forwarded",
        entityType: "inquiry",
        entityId: pid(req),
        inquiryId: pid(req),
        afterValue: { to: parsed.to },
      });
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/assign",
  requirePermission("inquiries.assign"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({ staffId: z.string().uuid().nullable().optional(), teamId: z.string().uuid().nullable().optional() })
        .parse(req.body ?? {});
      const [before] = await db
        .select()
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.id, pid(req)))
        .limit(1);
      await db
        .update(crmInquiriesTable)
        .set({
          assignedStaffId: parsed.staffId ?? null,
          assignedTeamId: parsed.teamId ?? before?.assignedTeamId ?? null,
          assignedReason: `Manual assignment by ${req.platformStaff!.name}`,
          status: parsed.staffId ? "ASSIGNED" : before?.status,
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        })
        .where(eq(crmInquiriesTable.id, pid(req)));
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "assignment.changed",
        entityType: "inquiry",
        entityId: pid(req),
        inquiryId: pid(req),
        beforeValue: { staffId: before?.assignedStaffId },
        afterValue: { staffId: parsed.staffId, teamId: parsed.teamId },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/status",
  requirePermission("inquiries.status"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          status: z.enum([
            "NEW",
            "TRIAGED",
            "ASSIGNED",
            "IN_PROGRESS",
            "WAITING_FOR_CUSTOMER",
            "WAITING_INTERNAL",
            "RESOLVED",
            "CLOSED",
            "SPAM",
            "DUPLICATE",
            "CANCELLED",
          ]),
        })
        .parse(req.body ?? {});
      const [before] = await db
        .select({ status: crmInquiriesTable.status })
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.id, pid(req)))
        .limit(1);
      await db
        .update(crmInquiriesTable)
        .set({
          status: parsed.status,
          resolvedAt: parsed.status === "RESOLVED" ? new Date() : undefined,
          closedAt: parsed.status === "CLOSED" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(crmInquiriesTable.id, pid(req)));
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "status.changed",
        entityType: "inquiry",
        entityId: pid(req),
        inquiryId: pid(req),
        beforeValue: { status: before?.status },
        afterValue: { status: parsed.status },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/priority",
  requirePermission("inquiries.priority"),
  async (req, res, next) => {
    try {
      const parsed = z.object({ priority: z.enum(["low", "normal", "high", "urgent"]) }).parse(req.body ?? {});
      await db
        .update(crmInquiriesTable)
        .set({ priority: parsed.priority, updatedAt: new Date() })
        .where(eq(crmInquiriesTable.id, pid(req)));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/tags",
  requirePermission("inquiries.tags"),
  async (req, res, next) => {
    try {
      const parsed = z.object({ slug: z.string().min(1).max(40) }).parse(req.body ?? {});
      await addTag(pid(req), parsed.slug);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/qualification",
  requirePermission("inquiries.qualification.override"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          status: z.enum([
            "UNASSESSED",
            "UNQUALIFIED",
            "MARKETING_QUALIFIED",
            "SALES_QUALIFIED",
            "HIGH_PRIORITY",
            "DISQUALIFIED",
          ]),
          reason: z.string().trim().min(3).max(500),
        })
        .parse(req.body ?? {});
      const [before] = await db
        .select()
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.id, pid(req)))
        .limit(1);
      await db
        .update(crmInquiriesTable)
        .set({
          humanOverrideStatus: parsed.status,
          humanOverrideReason: parsed.reason,
          humanOverrideBy: req.platformStaff!.id,
          humanOverrideAt: new Date(),
          qualificationStatus: parsed.status,
          updatedAt: new Date(),
        })
        .where(eq(crmInquiriesTable.id, pid(req)));
      await db.insert(crmQualificationResultsTable).values({
        inquiryId: pid(req),
        modelVersion: before?.qualificationModelVersion ?? 0,
        score: before?.qualificationScore ?? 0,
        status: parsed.status,
        reasons: [{ reason: parsed.reason, source: "human_override" }],
        source: "human_override",
      });
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "qualification.overridden",
        entityType: "inquiry",
        entityId: pid(req),
        inquiryId: pid(req),
        beforeValue: { status: before?.qualificationStatus },
        afterValue: { status: parsed.status, reason: parsed.reason },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/meeting",
  requirePermission("inquiries.reply"),
  async (req, res, next) => {
    try {
      const url = await generateMeetingInvitation(pid(req));
      res.json({ bookingUrl: url });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/macros/:key",
  requirePermission("inquiries.reply"),
  async (req, res, next) => {
    try {
      const [macro] = await db
        .select()
        .from(crmMacrosTable)
        .where(eq(crmMacrosTable.key, pid(req, "key")))
        .limit(1);
      if (!macro) {
        res.status(404).json({ error: "Macro not found" });
        return;
      }
      for (const action of macro.actions as Array<{ type: string; params?: Record<string, unknown> }>) {
        if (action.type === "generate_meeting") await generateMeetingInvitation(pid(req));
        if (action.type === "send_template" && action.params?.key) {
          await sendInquiryEmail(pid(req), String(action.params.key));
        }
        if (action.type === "change_status" && action.params?.status) {
          await db
            .update(crmInquiriesTable)
            .set({ status: String(action.params.status), updatedAt: new Date() })
            .where(eq(crmInquiriesTable.id, pid(req)));
        }
        if (action.type === "add_tag" && action.params?.slug) {
          await addTag(pid(req), String(action.params.slug));
        }
      }
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "macro.executed",
        entityType: "inquiry",
        entityId: pid(req),
        inquiryId: pid(req),
        afterValue: { key: macro.key },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/platform/contact/templates", requirePermission("inquiries.view"), async (_req, res, next) => {
  try {
    const templates = await db.select().from(crmTemplatesTable);
    const versions = await db.select().from(crmTemplateVersionsTable);
    res.json({ templates, versions });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/templates", requirePermission("templates.manage"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        key: z.string().min(2).max(80),
        internalName: z.string().min(2).max(120),
        category: z.string().max(40),
        language: z.string().max(8).default("en"),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(20000),
      })
      .parse(req.body ?? {});
    const [tpl] = await db
      .insert(crmTemplatesTable)
      .values({
        key: parsed.key,
        internalName: parsed.internalName,
        category: parsed.category,
        status: "draft",
        createdBy: req.platformStaff!.id,
      })
      .returning();
    await db.insert(crmTemplateVersionsTable).values({
      templateId: tpl.id,
      versionNumber: 1,
      language: parsed.language,
      subject: parsed.subject,
      body: parsed.body,
      changedBy: req.platformStaff!.id,
      changeSummary: "Created",
    });
    res.status(201).json(tpl);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/platform/contact/templates/:id/publish",
  requirePermission("templates.manage"),
  async (req, res, next) => {
    try {
      await db
        .update(crmTemplatesTable)
        .set({ status: "published", publishedAt: new Date(), updatedBy: req.platformStaff!.id })
        .where(eq(crmTemplatesTable.id, pid(req)));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/templates/:id/versions",
  requirePermission("templates.manage"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          language: z.string().max(8).default("en"),
          subject: z.string().min(1),
          body: z.string().min(1),
          changeSummary: z.string().max(200).optional(),
        })
        .parse(req.body ?? {});
      const [latest] = await db
        .select()
        .from(crmTemplateVersionsTable)
        .where(eq(crmTemplateVersionsTable.templateId, pid(req)))
        .orderBy(desc(crmTemplateVersionsTable.versionNumber))
        .limit(1);
      const [ver] = await db
        .insert(crmTemplateVersionsTable)
        .values({
          templateId: pid(req),
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          language: parsed.language,
          subject: parsed.subject,
          body: parsed.body,
          changeSummary: parsed.changeSummary ?? "Updated",
          changedBy: req.platformStaff!.id,
        })
        .returning();
      res.status(201).json(ver);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/platform/contact/config", requirePermission("inquiries.view"), async (_req, res, next) => {
  try {
    const [taxonomy, models, workflows, routing, sla, meetings, macros, tags] = await Promise.all([
      db.select().from(crmTaxonomyTable),
      db.select().from(crmQualificationModelsTable),
      db.select().from(crmWorkflowsTable),
      db.select().from(crmRoutingRulesTable),
      db.select().from(crmSlaPoliciesTable),
      db.select().from(crmMeetingTypesTable),
      db.select().from(crmMacrosTable),
      db.select().from(crmTagsTable),
    ]);
    res.json({ taxonomy, models, workflows, routing, sla, meetings, macros, tags });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/qualification-models/:id", requirePermission("config.manage"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        thresholds: z.record(z.number()),
        rules: z.array(z.record(z.unknown())),
        name: z.string().optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db
      .select()
      .from(crmQualificationModelsTable)
      .where(eq(crmQualificationModelsTable.id, pid(req)))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Model not found" });
      return;
    }
    await db
      .update(crmQualificationModelsTable)
      .set({ status: "archived" })
      .where(eq(crmQualificationModelsTable.id, current.id));
    const [nextModel] = await db
      .insert(crmQualificationModelsTable)
      .values({
        key: current.key,
        name: parsed.name ?? current.name,
        version: current.version + 1,
        status: "published",
        thresholds: parsed.thresholds,
        rules: parsed.rules,
        publishedAt: new Date(),
      })
      .returning();
    res.json(nextModel);
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/workflows/:id", requirePermission("workflows.manage"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        name: z.string().optional(),
        status: z.enum(["active", "disabled"]).optional(),
        conditions: z.array(z.record(z.unknown())).optional(),
        actions: z.array(z.record(z.unknown())).optional(),
      })
      .parse(req.body ?? {});
    const [updated] = await db
      .update(crmWorkflowsTable)
      .set({ ...parsed, version: sql`${crmWorkflowsTable.version} + 1`, updatedAt: new Date() })
      .where(eq(crmWorkflowsTable.id, pid(req)))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/routing/:id", requirePermission("routing.manage"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        name: z.string().optional(),
        priority: z.number().optional(),
        status: z.enum(["active", "disabled"]).optional(),
        conditions: z.array(z.record(z.unknown())).optional(),
        strategy: z.string().optional(),
        teamId: z.string().uuid().nullable().optional(),
        staffId: z.string().uuid().nullable().optional(),
        reasonTemplate: z.string().optional(),
      })
      .parse(req.body ?? {});
    const [updated] = await db
      .update(crmRoutingRulesTable)
      .set(parsed)
      .where(eq(crmRoutingRulesTable.id, pid(req)))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/sla/:id", requirePermission("sla.manage"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        name: z.string().optional(),
        firstResponseMinutes: z.number().optional(),
        nextResponseMinutes: z.number().nullable().optional(),
        resolutionMinutes: z.number().nullable().optional(),
        conditions: z.array(z.record(z.unknown())).optional(),
        status: z.enum(["active", "disabled"]).optional(),
      })
      .parse(req.body ?? {});
    const [updated] = await db
      .update(crmSlaPoliciesTable)
      .set({ ...parsed, version: sql`${crmSlaPoliciesTable.version} + 1` })
      .where(eq(crmSlaPoliciesTable.id, pid(req)))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/meetings/:id", requirePermission("meetings.manage"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        name: z.string().optional(),
        bookingUrl: z.string().url().optional(),
        durationMinutes: z.number().optional(),
        timezone: z.string().optional(),
        status: z.enum(["active", "disabled"]).optional(),
      })
      .parse(req.body ?? {});
    const [updated] = await db
      .update(crmMeetingTypesTable)
      .set(parsed)
      .where(eq(crmMeetingTypesTable.id, pid(req)))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/notifications", requirePermission("inquiries.view"), async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(crmNotificationsTable)
      .where(eq(crmNotificationsTable.staffId, req.platformStaff!.id))
      .orderBy(desc(crmNotificationsTable.createdAt))
      .limit(40);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/saved-views", requirePermission("inquiries.view"), async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(crmSavedViewsTable)
      .where(eq(crmSavedViewsTable.staffId, req.platformStaff!.id));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/saved-views", requirePermission("inquiries.view"), async (req, res, next) => {
  try {
    const parsed = z
      .object({ name: z.string().min(1).max(80), filters: z.record(z.unknown()) })
      .parse(req.body ?? {});
    const [row] = await db
      .insert(crmSavedViewsTable)
      .values({ staffId: req.platformStaff!.id, name: parsed.name, filters: parsed.filters })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/analytics", requirePermission("analytics.view"), async (_req, res, next) => {
  try {
    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) filter (where qualification_status in ('SALES_QUALIFIED','HIGH_PRIORITY'))::int`,
        open: sql<number>`count(*) filter (where status not in ('CLOSED','RESOLVED','SPAM','CANCELLED'))::int`,
      })
      .from(crmInquiriesTable);
    const byCountry = await db
      .select({
        country: crmContactsTable.country,
        count: sql<number>`count(*)::int`,
      })
      .from(crmInquiriesTable)
      .innerJoin(crmContactsTable, eq(crmContactsTable.id, crmInquiriesTable.contactId))
      .groupBy(crmContactsTable.country);
    const events = await db
      .select({
        event: crmAnalyticsEventsTable.event,
        count: sql<number>`count(*)::int`,
      })
      .from(crmAnalyticsEventsTable)
      .groupBy(crmAnalyticsEventsTable.event);
    const [sla] = await db
      .select({
        breached: sql<number>`count(*) filter (where status = 'BREACHED')::int`,
        onTrack: sql<number>`count(*) filter (where status = 'ON_TRACK')::int`,
        atRisk: sql<number>`count(*) filter (where status = 'AT_RISK')::int`,
      })
      .from(crmSlaInstancesTable);
    res.json({ totals, byCountry, events, sla });
  } catch (err) {
    next(err);
  }
});

export default router;
