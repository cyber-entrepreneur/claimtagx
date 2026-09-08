import { createReadStream } from "node:fs";
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { timingSafeEqual, randomUUID } from "node:crypto";
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
  crmTeamMembersTable,
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
  crmJobsTable,
  crmStaffInvitesTable,
  crmConfigTable,
  crmRecordLocksTable,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  or,
  sql,
  isNull,
  type SQL,
} from "drizzle-orm";
import {
  clearStaffSessionCookie,
  decodeStaffSession,
  requirePermission,
  requirePlatformAdmin,
  revokeStaffSessions,
  setStaffSessionCookie,
  upsertStaffFromIdentity,
} from "../middlewares/requirePlatformAdmin";
import { isLegacyAccessKeyLoginAllowed } from "../lib/crm/authFlags";
import { requireAdminRateLimit } from "../lib/crm/adminRateLimit";
import { ensureCrmSeeded } from "../lib/crm/seed";
import { writeAudit } from "../lib/crm/audit";
import {
  generateMeetingInvitation,
  sendInquiryEmail,
  addTag,
  loadInquiryContext,
  loadEmailThreadParent,
  mergeVarsFor,
} from "../lib/crm/jobs";
import { renderTemplate, textToHtml } from "../lib/crm/templates";
import { sendTransactionalEmail } from "../lib/email";
import { buildThreadingHeaders } from "../lib/crm/emailThreading";
import { extractMailDomain } from "../lib/crm/emailProvider";
import { onStaffCustomerReply, pauseInquirySla, resumeInquirySla } from "../lib/crm/slaLifecycle";
import { redactContactForRole, staffCanViewPii } from "../lib/crm/governance";
import { createGovernedDraft } from "../lib/crm/configChangeCommands";
import { parseAnalyticsWindow } from "../lib/crm/analyticsQuery";
import { applyContactMerge } from "../lib/crm/contactMerge";
import { listDeadLetterJobs, replayDeadLetterJob } from "../lib/crm/queue";
import {
  assertInquiryAccess,
  decodeInquiryCursor,
  encodeInquiryCursor,
  privilegedInquiryAccess,
} from "../lib/crm/objectAuth";
import { boundedPageSize, decodeTimeIdCursor, encodeTimeIdCursor } from "../lib/crm/keysetCursor";
import { ROLE_PERMISSIONS, hasPermission } from "../lib/crm/rbac";
import {
  acquireLock,
  heartbeatLock,
  heartbeatPresence,
  isRecordLockEntityType,
  listPresence,
  overrideLock,
  releaseLock,
  RecordLockConflictError,
  type RecordLockEntityType,
} from "../lib/crm/recordLock";
import {
  cancelExport,
  enqueueExport,
  getDownload,
  getExport,
  listExports,
} from "../lib/crm/exportJobs";

const router: IRouter = Router();

function httpError(err: unknown, res: import("express").Response, next: import("express").NextFunction): void {
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    const status = (err as { status: number; message?: string; code?: string }).status;
    res.status(status).json({
      error: (err as { message?: string }).message ?? "Request failed",
      code: (err as { code?: string }).code,
    });
    return;
  }
  next(err);
}

function pid(req: Request, name = "id"): string {
  const v = req.params[name];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

router.post("/platform/auth/login", async (req, res, next) => {
  try {
    if (!isLegacyAccessKeyLoginAllowed()) {
      res.status(410).json({
        error:
          "Shared access-key login is disabled. Sign in with your ClaimTagX identity provider (Clerk).",
      });
      return;
    }
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
    const provided = parsed.data.accessKey;
    if (!expected) {
      res.status(401).json({ error: "Invalid access key." });
      return;
    }
    // Constant-time compare (ASVS V2) — avoid early-exit string equality on secrets.
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
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

router.post("/platform/auth/logout", async (req, res) => {
  const cookie = req.cookies?.ctx_platform_session as string | undefined;
  const session = cookie ? decodeStaffSession(cookie) : null;
  const staffId = req.platformStaff?.id ?? session?.staffId;
  clearStaffSessionCookie(res);
  if (staffId) {
    try {
      await revokeStaffSessions(staffId);
    } catch {
      /* revocation table must not block logout cookie clear */
    }
    void writeAudit({
      actorType: "staff",
      actorId: staffId,
      action: "auth.logout",
      entityType: "session",
      entityId: staffId,
    }).catch(() => undefined);
  }
  res.status(204).end();
});

/** Non-production only: mint session cookie for local admin E2E (not Clerk evidence). */
router.post("/platform/auth/test-login", async (req, res) => {
  if (process.env.CRM_HTTP_TEST_AUTH !== "true" || process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const staffId = typeof req.body?.staffId === "string" ? req.body.staffId : "";
  if (!staffId || staffId.length < 10) {
    res.status(400).json({ error: "staffId required" });
    return;
  }
  const [row] = await db.select().from(crmStaffTable).where(eq(crmStaffTable.id, staffId)).limit(1);
  if (!row || row.status !== "active") {
    res.status(404).json({ error: "Staff not found" });
    return;
  }
  setStaffSessionCookie(res, row);
  if (!res.getHeader("set-cookie")) {
    res.status(500).json({
      error:
        "Session cookie not issued — set PLATFORM_STAFF_SESSION_SECRET (or non-prod PLATFORM_STAFF_ACCESS_KEY)",
    });
    return;
  }
  const permissions =
    row.permissions && row.permissions.length > 0 ? row.permissions : (ROLE_PERMISSIONS[row.role] ?? []);
  res.json({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    permissions,
  });
});

router.use("/platform", requirePlatformAdmin);
router.use("/platform", requireAdminRateLimit);
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
  const permissions =
    s.permissions && s.permissions.length > 0 ? s.permissions : (ROLE_PERMISSIONS[s.role] ?? []);
  res.json({
    id: s.id,
    email: s.email,
    name: s.name,
    role: s.role,
    permissions,
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

router.post(
  "/platform/contact/staff/invite",
  requirePermission("config.manage"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          email: z.string().email(),
          role: z.enum(["owner", "admin", "sales", "operator", "analyst"]).default("sales"),
        })
        .parse(req.body ?? {});
      const emailNormalized = parsed.email.trim().toLowerCase();
      const [row] = await db
        .insert(crmStaffInvitesTable)
        .values({
          emailNormalized,
          role: parsed.role,
          invitedBy: req.platformStaff!.id,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
        })
        .onConflictDoUpdate({
          target: crmStaffInvitesTable.emailNormalized,
          set: {
            role: parsed.role,
            invitedBy: req.platformStaff!.id,
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
            acceptedAt: null,
          },
        })
        .returning();
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "staff.invited",
        entityType: "staff_invite",
        entityId: row.id,
        afterValue: { emailNormalized, role: parsed.role },
      });
      res.status(201).json({ id: row.id, emailNormalized, role: row.role, expiresAt: row.expiresAt });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/platform/contact/inquiries",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const staff = req.platformStaff!;
      const q = req.query;
      const limit = Math.min(Number(q.limit ?? 50) || 50, 100);
      const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
      const cursorRaw = typeof q.cursor === "string" ? q.cursor : "";
      const cursor = cursorRaw ? decodeInquiryCursor(cursorRaw) : null;
      const sort = String(q.sort ?? "createdAt");
      const useKeyset = sort === "createdAt";
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
      if (typeof q.inquiryType === "string" && q.inquiryType) {
        filters.push(eq(crmInquiriesTable.inquiryType, q.inquiryType));
      }
      if (typeof q.priority === "string" && q.priority) {
        filters.push(eq(crmInquiriesTable.priority, q.priority));
      }
      if (typeof q.assignedTeamId === "string" && q.assignedTeamId) {
        filters.push(eq(crmInquiriesTable.assignedTeamId, q.assignedTeamId));
      }
      if (typeof q.reference === "string" && q.reference.trim()) {
        filters.push(ilike(crmInquiriesTable.reference, `%${q.reference.trim()}%`));
      }
      if (typeof q.tag === "string" && q.tag.trim()) {
        filters.push(
          sql`exists (
            select 1 from crm_inquiry_tags it
            join crm_tags tg on tg.id = it.tag_id
            where it.inquiry_id = ${crmInquiriesTable.id}
              and (tg.slug = ${q.tag.trim()} or tg.label ilike ${"%" + q.tag.trim() + "%"})
          )`,
        );
      }
      if (typeof q.slaStatus === "string" && q.slaStatus) {
        filters.push(
          sql`exists (
            select 1 from crm_sla_instances s
            where s.inquiry_id = ${crmInquiriesTable.id}
              and s.measure = 'first_response'
              and s.status = ${q.slaStatus}
          )`,
        );
      }
      if (typeof q.hasConsent === "string" && (q.hasConsent === "true" || q.hasConsent === "false")) {
        const want = q.hasConsent === "true";
        filters.push(
          want
            ? sql`exists (select 1 from crm_consent_records c where c.contact_id = ${crmContactsTable.id})`
            : sql`not exists (select 1 from crm_consent_records c where c.contact_id = ${crmContactsTable.id})`,
        );
      }
      if (typeof q.updatedFrom === "string") {
        filters.push(gte(crmInquiriesTable.updatedAt, new Date(q.updatedFrom)));
      }
      if (typeof q.updatedTo === "string") {
        filters.push(lte(crmInquiriesTable.updatedAt, new Date(q.updatedTo)));
      }
      if (typeof q.source === "string" && q.source) filters.push(eq(crmInquiriesTable.source, q.source));
      if (typeof q.channel === "string" && q.channel) {
        const ch = q.channel === "website" ? "web_form" : q.channel;
        filters.push(eq(crmInquiriesTable.channel, ch));
      }
      if (!privilegedInquiryAccess(staff) && staff.role !== "auditor" && staff.role !== "analyst") {
        const unassigned = and(isNull(crmInquiriesTable.assignedStaffId), isNull(crmInquiriesTable.assignedTeamId));
        const mine = eq(crmInquiriesTable.assignedStaffId, staff.id);
        filters.push(
          staff.teamId
            ? or(mine, eq(crmInquiriesTable.assignedTeamId, staff.teamId), unassigned)!
            : or(mine, unassigned)!,
        );
      }
      if (q.readState === "unread") {
        filters.push(
          sql`(
            not exists (
              select 1 from crm_inquiry_reads ir
              where ir.inquiry_id = ${crmInquiriesTable.id}
                and ir.staff_id = ${staff.id}
            )
            or exists (
              select 1 from crm_inquiry_reads ir
              where ir.inquiry_id = ${crmInquiriesTable.id}
                and ir.staff_id = ${staff.id}
                and ${crmInquiriesTable.lastCustomerMessageAt} is not null
                and ir.last_read_at < ${crmInquiriesTable.lastCustomerMessageAt}
            )
          )`,
        );
      }
      if (q.readState === "read") {
        filters.push(
          sql`exists (
            select 1 from crm_inquiry_reads ir
            where ir.inquiry_id = ${crmInquiriesTable.id}
              and ir.staff_id = ${staff.id}
              and (
                ${crmInquiriesTable.lastCustomerMessageAt} is null
                or ir.last_read_at >= ${crmInquiriesTable.lastCustomerMessageAt}
              )
          )`,
        );
      }
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
      if (useKeyset && cursor) {
        if (dir === "desc") {
          filters.push(
            or(
              lt(crmInquiriesTable.createdAt, cursor.createdAt),
              and(eq(crmInquiriesTable.createdAt, cursor.createdAt), lt(crmInquiriesTable.id, cursor.id)),
            )!,
          );
        } else {
          filters.push(
            or(
              gt(crmInquiriesTable.createdAt, cursor.createdAt),
              and(eq(crmInquiriesTable.createdAt, cursor.createdAt), gt(crmInquiriesTable.id, cursor.id)),
            )!,
          );
        }
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
        .orderBy(
          dir === "asc" ? sortCol : desc(sortCol),
          dir === "asc" ? crmInquiriesTable.id : desc(crmInquiriesTable.id),
        )
        .limit(limit)
        .offset(useKeyset ? 0 : offset);

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
      const previewByInquiry = new Map<string, string>();
      if (rows.length) {
        const previews = await db
          .select({
            inquiryId: crmMessagesTable.inquiryId,
            body: crmMessagesTable.body,
            createdAt: crmMessagesTable.createdAt,
          })
          .from(crmMessagesTable)
          .where(inArray(crmMessagesTable.inquiryId, rows.map((r) => r.inquiry.id)))
          .orderBy(desc(crmMessagesTable.createdAt));
        for (const p of previews) {
          if (!previewByInquiry.has(p.inquiryId)) previewByInquiry.set(p.inquiryId, p.body.slice(0, 180));
        }
      }

      const items = rows
        .map((r) => {
          const unread =
            !r.readAt ||
            (r.inquiry.lastCustomerMessageAt &&
              r.readAt.getTime() < r.inquiry.lastCustomerMessageAt.getTime()) ||
            (!r.inquiry.lastCustomerMessageAt && r.readAt.getTime() < r.inquiry.createdAt.getTime());
          const sla = slaByInquiry.get(r.inquiry.id);
          const canViewPii = staffCanViewPii(staff);
          const contact = redactContactForRole(
            {
              firstName: r.contact.firstName,
              lastName: r.contact.lastName,
              email: r.contact.email,
              phoneE164: r.contact.phoneE164,
            },
            canViewPii,
          );
          return {
            id: r.inquiry.id,
            reference: r.inquiry.reference,
            createdAt: r.inquiry.createdAt.toISOString(),
            lastActivityAt: r.inquiry.lastActivityAt.toISOString(),
            firstName: contact.firstName,
            lastName: contact.lastName,
            company: r.company?.name ?? "",
            jobTitle: r.contact.jobTitle,
            country: r.contact.country,
            useCase: r.inquiry.useCaseKeys,
            qualificationStatus: r.inquiry.qualificationStatus,
            leadScore: r.inquiry.qualificationScore,
            assignedTo: r.assignee?.name ?? null,
            assignedStaffId: r.inquiry.assignedStaffId,
            status: r.inquiry.status,
            channel: r.inquiry.channel,
            priority: r.inquiry.priority,
            unread,
            slaStatus: sla?.status ?? null,
            slaDueAt: sla?.dueAt?.toISOString() ?? null,
            hasMeeting: false,
            lastMessagePreview: previewByInquiry.get(r.inquiry.id) ?? "",
          };
        })
        .filter(Boolean);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmInquiriesTable)
        .innerJoin(crmContactsTable, eq(crmContactsTable.id, crmInquiriesTable.contactId))
        .leftJoin(crmCompaniesTable, eq(crmCompaniesTable.id, crmInquiriesTable.companyId))
        .where(where);

      const last = rows[rows.length - 1]?.inquiry;
      const nextCursor =
        useKeyset && last && rows.length === limit
          ? encodeInquiryCursor({ createdAt: last.createdAt, id: last.id })
          : null;

      res.json({ items, total: count, limit, offset: useKeyset ? 0 : offset, nextCursor, cursor: cursorRaw || null });
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
      assertInquiryAccess(staff, inquiry, "view");
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
        .orderBy(sql`coalesce(${crmMessagesTable.providerTimestamp}, ${crmMessagesTable.createdAt})`, crmMessagesTable.id);
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
      const canViewPii = staffCanViewPii(staff);
      const { getChannelAdapter, inquiryChannelToInbox, TIKTOK_HANDOFF_URL, LINKEDIN_HANDOFF_URL } = await import("../lib/crm/connectors/registry");
      const inboxChannel = inquiryChannelToInbox(inquiry.channel);
      const adapter = getChannelAdapter(inboxChannel);
      const composer = adapter.capabilities();
      const { crmChannelIdentitiesTable } = await import("@workspace/db");
      const identities = await db
        .select()
        .from(crmChannelIdentitiesTable)
        .where(eq(crmChannelIdentitiesTable.contactId, inquiry.contactId));
      res.json({
        inquiry: { ...inquiry, updatedAt: inquiry.updatedAt.toISOString() },
        contact: contact
          ? redactContactForRole(
              {
                firstName: contact.firstName,
                lastName: contact.lastName,
                email: contact.email,
                phoneE164: contact.phoneE164,
              },
              canViewPii,
            )
          : contact,
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
        channel: inquiry.channel,
        inboxChannel,
        composer: {
          ...composer,
          disabledReason: composer.outbound
            ? null
            : composer.manualHandoff
              ? inboxChannel === "tiktok"
                ? `TikTok has no public support DM API. Open ${TIKTOK_HANDOFF_URL}`
                : `LinkedIn private messaging is partner-gated. Open ${LINKEDIN_HANDOFF_URL}`
              : `Replies are not supported on ${inboxChannel}`,
        },
        identities,
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
  "/platform/contact/inquiries/bulk-assign",
  requirePermission("inquiries.assign"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          ids: z.array(z.string().uuid()).min(1).max(100),
          staffId: z.string().uuid(),
          confirm: z.literal(true),
        })
        .parse(req.body ?? {});
      const existing = await db
        .select({ id: crmInquiriesTable.id, assignedStaffId: crmInquiriesTable.assignedStaffId })
        .from(crmInquiriesTable)
        .where(inArray(crmInquiriesTable.id, parsed.ids));
      const byId = new Map(existing.map((r) => [r.id, r]));
      const succeeded: string[] = [];
      const failed: Array<{ id: string; reason: string; code?: string }> = [];
      for (const id of parsed.ids) {
        const row = byId.get(id);
        if (!row) {
          failed.push({ id, reason: "not_found", code: "NOT_FOUND" });
          continue;
        }
        try {
          assertInquiryAccess(req.platformStaff!, row, "assign");
          succeeded.push(id);
        } catch (err) {
          failed.push({
            id,
            reason: err instanceof Error ? err.message : "denied",
            code: (err as { code?: string }).code ?? "OBJECT_AUTH_DENIED",
          });
        }
      }
      if (succeeded.length) {
        await db
          .update(crmInquiriesTable)
          .set({
            assignedStaffId: parsed.staffId,
            status: "ASSIGNED",
            updatedAt: new Date(),
          })
          .where(inArray(crmInquiriesTable.id, succeeded));
        await writeAudit({
          actorType: "staff",
          actorId: req.platformStaff!.id,
          action: "inquiry.bulk_assigned",
          entityType: "inquiry",
          entityId: succeeded[0],
          afterValue: { succeeded: succeeded.length, failed: failed.length, staffId: parsed.staffId },
        });
      }
      res.json({ updated: succeeded.length, succeeded, failed });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/bulk-status",
  requirePermission("inquiries.status"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          ids: z.array(z.string().uuid()).min(1).max(100),
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
          ]),
          confirm: z.literal(true),
        })
        .parse(req.body ?? {});
      const existing = await db
        .select({ id: crmInquiriesTable.id, assignedStaffId: crmInquiriesTable.assignedStaffId })
        .from(crmInquiriesTable)
        .where(inArray(crmInquiriesTable.id, parsed.ids));
      const byId = new Map(existing.map((r) => [r.id, r]));
      const succeeded: string[] = [];
      const failed: Array<{ id: string; reason: string; code?: string }> = [];
      for (const id of parsed.ids) {
        const row = byId.get(id);
        if (!row) {
          failed.push({ id, reason: "not_found", code: "NOT_FOUND" });
          continue;
        }
        try {
          assertInquiryAccess(req.platformStaff!, row, "mutate");
          succeeded.push(id);
        } catch (err) {
          failed.push({
            id,
            reason: err instanceof Error ? err.message : "denied",
            code: (err as { code?: string }).code ?? "OBJECT_AUTH_DENIED",
          });
        }
      }
      if (succeeded.length) {
        await db
          .update(crmInquiriesTable)
          .set({ status: parsed.status, updatedAt: new Date() })
          .where(inArray(crmInquiriesTable.id, succeeded));
        await writeAudit({
          actorType: "staff",
          actorId: req.platformStaff!.id,
          action: "inquiry.bulk_status",
          entityType: "inquiry",
          entityId: succeeded[0],
          afterValue: { succeeded: succeeded.length, failed: failed.length, status: parsed.status },
        });
      }
      res.json({ updated: succeeded.length, succeeded, failed });
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
          expectedUpdatedAt: z.string().datetime().optional(),
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
      assertInquiryAccess(req.platformStaff!, inquiry, "mutate");
      const { getChannelAdapter, inquiryChannelToInbox } = await import("../lib/crm/connectors/registry");
      const { ConnectorCapabilityError } = await import("../lib/crm/connectors/types");
      const adapter = getChannelAdapter(inquiryChannelToInbox(inquiry.channel));
      const caps = adapter.capabilities();
      if (!caps.outbound) {
        throw new ConnectorCapabilityError(
          caps.manualHandoff ? "This channel does not support in-product replies" : "Replies are not supported on this channel",
          caps.manualHandoff ? "MANUAL_HANDOFF" : "NO_OUTBOUND",
        );
      }
      if (
        parsed.expectedUpdatedAt &&
        inquiry.updatedAt.toISOString() !== parsed.expectedUpdatedAt
      ) {
        res.status(409).json({
          error: "This inquiry changed since you loaded it. Refresh and try again.",
          updatedAt: inquiry.updatedAt.toISOString(),
        });
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
      const html = `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:24px">${textToHtml(body)}</div>`;
      const inboxChannel = inquiryChannelToInbox(inquiry.channel);
      if (inboxChannel !== "website" && inboxChannel !== "microsoft365") {
        const queued = await db.transaction(async (tx) => {
          const { queueStaffReply } = await import("../lib/crm/connectors/outbound");
          return queueStaffReply({
            inquiryId: inquiry.id,
            staffId: req.platformStaff!.id,
            body,
            html,
            subject,
            executor: tx,
            conversationId: conversation?.id,
          });
        });
        const now = new Date();
        await db
          .update(crmInquiriesTable)
          .set({
            lastActivityAt: now,
            firstResponseAt: inquiry.firstResponseAt ?? now,
            status: "WAITING_FOR_CUSTOMER",
            updatedAt: now,
          })
          .where(eq(crmInquiriesTable.id, inquiry.id));
        await onStaffCustomerReply(inquiry.id, inquiry.firstResponseAt, now);
        await writeAudit({
          actorType: "staff",
          actorId: req.platformStaff!.id,
          action: "message.replied",
          entityType: "inquiry",
          entityId: inquiry.id,
          inquiryId: inquiry.id,
          afterValue: { channel: inboxChannel, deliveryStatus: queued.deliveryStatus },
        });
        res.status(201).json({ id: queued.messageId, deliveryStatus: queued.deliveryStatus });
        return;
      }
      const threading = buildThreadingHeaders(
        await loadEmailThreadParent(inquiry.id),
        extractMailDomain(),
      );
      let providerMessageId: string | null = null;
      if (contact) {
        providerMessageId = await sendTransactionalEmail({
          to: contact.email,
          subject,
          text: body,
          html,
          headers: {
            messageId: threading.messageId,
            inReplyTo: threading.inReplyTo,
            references: threading.references,
          },
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
          textBody: body,
          sanitizedHtml: html,
          messageId: threading.messageId,
          inReplyTo: threading.inReplyTo ?? null,
          referencesHeader: threading.references ?? null,
          providerMessageId,
          externalMessageId: threading.messageId,
          deliveryStatus: providerMessageId ? "accepted" : contact ? "skipped" : "unsent",
        })
        .returning();
      const now = new Date();
      await db
        .update(crmInquiriesTable)
        .set({
          lastActivityAt: now,
          firstResponseAt: inquiry.firstResponseAt ?? now,
          status: "WAITING_FOR_CUSTOMER",
          updatedAt: now,
        })
        .where(eq(crmInquiriesTable.id, inquiry.id));
      await onStaffCustomerReply(inquiry.id, inquiry.firstResponseAt, now);
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
      httpError(err, res, next);
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
      if (!before) {
        res.status(404).json({ error: "Inquiry not found" });
        return;
      }
      assertInquiryAccess(req.platformStaff!, before, "assign");
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
      httpError(err, res, next);
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
        .select({ status: crmInquiriesTable.status, assignedStaffId: crmInquiriesTable.assignedStaffId })
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.id, pid(req)))
        .limit(1);
      if (!before) {
        res.status(404).json({ error: "Inquiry not found" });
        return;
      }
      assertInquiryAccess(req.platformStaff!, before, "mutate");
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
      httpError(err, res, next);
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
  "/platform/contact/inquiries/:id/convert-lead",
  requirePermission("inquiries.qualification.override"),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          opportunityName: z.string().min(1).max(160).optional(),
          note: z.string().max(500).optional(),
        })
        .parse(req.body ?? {});
      const [inq] = await db.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.id, pid(req))).limit(1);
      if (!inq) {
        res.status(404).json({ error: "Inquiry not found" });
        return;
      }
      const [updated] = await db
        .update(crmInquiriesTable)
        .set({
          status: "IN_PROGRESS",
          qualificationStatus: "SALES_QUALIFIED",
          humanOverrideStatus: "SALES_QUALIFIED",
          humanOverrideReason: parsed.note ?? "Converted to sales opportunity",
          humanOverrideBy: req.platformStaff!.id,
          humanOverrideAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(crmInquiriesTable.id, inq.id))
        .returning();
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "inquiry.convert_lead",
        entityType: "inquiry",
        entityId: inq.id,
        inquiryId: inq.id,
        contactId: inq.contactId,
        afterValue: {
          opportunityName: parsed.opportunityName ?? `Opportunity from ${inq.reference}`,
          note: parsed.note ?? null,
        },
      });
      res.json({ inquiry: updated, opportunityName: parsed.opportunityName ?? `Opportunity from ${inq.reference}` });
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

router.post("/platform/contact/templates", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        key: z.string().min(2).max(80),
        internalName: z.string().min(2).max(120),
        category: z.string().max(40),
        language: z.string().max(8).default("en"),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(20000),
        rationale: z.string().min(3).max(500).optional(),
      })
      .parse(req.body ?? {});
    const entityId = randomUUID();
    const row = await createGovernedDraft({
      entityType: "template_create",
      entityId,
      authorStaffId: req.platformStaff!.id,
      beforeValue: null,
      afterValue: {
        key: parsed.key,
        internalName: parsed.internalName,
        category: parsed.category,
        language: parsed.language,
        subject: parsed.subject,
        body: parsed.body,
        createdBy: req.platformStaff!.id,
      },
      rationale: parsed.rationale ?? "template create",
      correlationId: req.headers["x-request-id"] as string | undefined,
    });
    res.status(201).json({
      changeId: row.id,
      status: "draft",
      entityId,
      message: "Direct template creation is not allowed. A governed draft was created.",
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/platform/contact/templates/:id/publish",
  requirePermission("config.propose"),
  async (req, res, next) => {
    try {
      const [tpl] = await db.select().from(crmTemplatesTable).where(eq(crmTemplatesTable.id, pid(req))).limit(1);
      if (!tpl) {
        res.status(404).json({ error: "Template not found" });
        return;
      }
      const row = await createGovernedDraft({
        entityType: "template_publish",
        entityId: tpl.id,
        authorStaffId: req.platformStaff!.id,
        beforeValue: { status: tpl.status },
        afterValue: { status: "published" },
        rationale: typeof req.body?.rationale === "string" ? req.body.rationale : "template publish",
        correlationId: req.headers["x-request-id"] as string | undefined,
      });
      res.status(201).json({
        changeId: row.id,
        status: "draft",
        message: "Direct publication is not allowed. A governed draft was created.",
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/templates/:id/versions",
  requirePermission("config.propose"),
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
      const row = await createGovernedDraft({
        entityType: "template_version",
        entityId: pid(req),
        authorStaffId: req.platformStaff!.id,
        beforeValue: latest
          ? { versionNumber: latest.versionNumber, subject: latest.subject, body: latest.body }
          : null,
        afterValue: parsed,
        rationale: parsed.changeSummary,
      });
      res.status(201).json({
        changeId: row.id,
        status: "draft",
        message: "Direct template version writes are not allowed. A governed draft was created.",
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/platform/contact/config", requirePermission("inquiries.view"), async (_req, res, next) => {
  try {
    const [taxonomy, models, workflows, routing, sla, meetings, macros, tags, notificationRows] = await Promise.all([
      db.select().from(crmTaxonomyTable),
      db.select().from(crmQualificationModelsTable),
      db.select().from(crmWorkflowsTable),
      db.select().from(crmRoutingRulesTable),
      db.select().from(crmSlaPoliciesTable),
      db.select().from(crmMeetingTypesTable),
      db.select().from(crmMacrosTable),
      db.select().from(crmTagsTable),
      db.select().from(crmConfigTable).where(eq(crmConfigTable.key, "notification_policy")).limit(1),
    ]);
    res.json({
      taxonomy,
      models,
      workflows,
      routing,
      sla,
      meetings,
      macros,
      tags,
      notificationPolicy: notificationRows[0]?.value ?? { channels: ["in_app"], slaBreach: true },
    });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/taxonomy/:id", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        label: z.string().min(1).max(200).optional(),
        sortOrder: z.number().int().optional(),
        active: z.boolean().optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db.select().from(crmTaxonomyTable).where(eq(crmTaxonomyTable.id, pid(req))).limit(1);
    if (!current) {
      res.status(404).json({ error: "Taxonomy item not found" });
      return;
    }
    const row = await createGovernedDraft({
      entityType: "taxonomy",
      entityId: current.id,
      authorStaffId: req.platformStaff!.id,
      beforeValue: { label: current.label, sortOrder: current.sortOrder, active: current.active },
      afterValue: {
        label: parsed.label ?? current.label,
        sortOrder: parsed.sortOrder ?? current.sortOrder,
        active: parsed.active ?? current.active,
      },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/qualification-models/:id", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        thresholds: z.record(z.number()),
        rules: z.array(z.record(z.unknown())),
        name: z.string().optional(),
        rationale: z.string().max(500).optional(),
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
    const row = await createGovernedDraft({
      entityType: "qualification_model",
      entityId: current.id,
      authorStaffId: req.platformStaff!.id,
      beforeValue: { name: current.name, thresholds: current.thresholds, rules: current.rules },
      afterValue: { name: parsed.name ?? current.name, thresholds: parsed.thresholds, rules: parsed.rules },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/workflows/:id", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        name: z.string().optional(),
        status: z.enum(["active", "disabled"]).optional(),
        conditions: z.array(z.record(z.unknown())).optional(),
        actions: z.array(z.record(z.unknown())).optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db.select().from(crmWorkflowsTable).where(eq(crmWorkflowsTable.id, pid(req))).limit(1);
    if (!current) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    const row = await createGovernedDraft({
      entityType: "workflow",
      entityId: current.id,
      authorStaffId: req.platformStaff!.id,
      beforeValue: { name: current.name, status: current.status },
      afterValue: { name: parsed.name ?? current.name, status: parsed.status ?? current.status, conditions: parsed.conditions, actions: parsed.actions },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/routing/:id", requirePermission("config.propose"), async (req, res, next) => {
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
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db.select().from(crmRoutingRulesTable).where(eq(crmRoutingRulesTable.id, pid(req))).limit(1);
    if (!current) {
      res.status(404).json({ error: "Routing rule not found" });
      return;
    }
    const row = await createGovernedDraft({
      entityType: "routing_rule",
      entityId: current.id,
      authorStaffId: req.platformStaff!.id,
      beforeValue: { name: current.name, priority: current.priority, strategy: current.strategy, status: current.status },
      afterValue: {
        name: parsed.name ?? current.name,
        priority: parsed.priority ?? current.priority,
        strategy: parsed.strategy ?? current.strategy,
        status: parsed.status ?? current.status,
      },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/sla/:id", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        name: z.string().optional(),
        firstResponseMinutes: z.number().optional(),
        nextResponseMinutes: z.number().nullable().optional(),
        resolutionMinutes: z.number().nullable().optional(),
        conditions: z.array(z.record(z.unknown())).optional(),
        holidays: z.array(z.string()).optional(),
        timeZone: z.string().optional(),
        status: z.enum(["active", "disabled"]).optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db.select().from(crmSlaPoliciesTable).where(eq(crmSlaPoliciesTable.id, pid(req))).limit(1);
    if (!current) {
      res.status(404).json({ error: "SLA policy not found" });
      return;
    }
    const row = await createGovernedDraft({
      entityType: "sla_policy",
      entityId: current.id,
      authorStaffId: req.platformStaff!.id,
      beforeValue: {
        firstResponseMinutes: current.firstResponseMinutes,
        nextResponseMinutes: current.nextResponseMinutes,
        resolutionMinutes: current.resolutionMinutes,
        holidays: current.holidays,
        timeZone: current.timeZone,
      },
      afterValue: { ...parsed },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/meetings/:id", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        name: z.string().optional(),
        bookingUrl: z.string().url().optional(),
        durationMinutes: z.number().optional(),
        timezone: z.string().optional(),
        status: z.enum(["active", "disabled"]).optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db.select().from(crmMeetingTypesTable).where(eq(crmMeetingTypesTable.id, pid(req))).limit(1);
    if (!current) {
      res.status(404).json({ error: "Meeting type not found" });
      return;
    }
    const row = await createGovernedDraft({
      entityType: "meeting_type",
      entityId: current.id,
      authorStaffId: req.platformStaff!.id,
      beforeValue: { name: current.name, bookingUrl: current.bookingUrl, durationMinutes: current.durationMinutes },
      afterValue: {
        name: parsed.name ?? current.name,
        bookingUrl: parsed.bookingUrl ?? current.bookingUrl,
        durationMinutes: parsed.durationMinutes ?? current.durationMinutes,
      },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/macros/:id", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        status: z.enum(["active", "disabled"]).optional(),
        actions: z.array(z.record(z.unknown())).optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db.select().from(crmMacrosTable).where(eq(crmMacrosTable.id, pid(req))).limit(1);
    if (!current) {
      res.status(404).json({ error: "Macro not found" });
      return;
    }
    const row = await createGovernedDraft({
      entityType: "macro",
      entityId: current.id,
      authorStaffId: req.platformStaff!.id,
      beforeValue: { name: current.name, status: current.status, description: current.description },
      afterValue: {
        name: parsed.name ?? current.name,
        description: parsed.description ?? current.description,
        status: parsed.status ?? current.status,
        actions: parsed.actions ?? current.actions,
      },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/tags/:id", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        label: z.string().optional(),
        color: z.string().nullable().optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db.select().from(crmTagsTable).where(eq(crmTagsTable.id, pid(req))).limit(1);
    if (!current) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    const row = await createGovernedDraft({
      entityType: "tag",
      entityId: current.id,
      authorStaffId: req.platformStaff!.id,
      beforeValue: { label: current.label, color: current.color },
      afterValue: { label: parsed.label ?? current.label, color: parsed.color ?? current.color },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/notification-policy", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        channels: z.array(z.string()).optional(),
        slaBreach: z.boolean().optional(),
        assignment: z.boolean().optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db
      .select()
      .from(crmConfigTable)
      .where(eq(crmConfigTable.key, "notification_policy"))
      .limit(1);
    const row = await createGovernedDraft({
      entityType: "notification_policy",
      entityId: "notification_policy",
      authorStaffId: req.platformStaff!.id,
      beforeValue: (current?.value as Record<string, unknown>) ?? null,
      afterValue: {
        channels: parsed.channels ?? ["in_app"],
        slaBreach: parsed.slaBreach ?? true,
        assignment: parsed.assignment ?? true,
      },
      rationale: parsed.rationale,
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/business-calendar", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        timeZone: z.string().min(1).max(80),
        weekdays: z.array(z.number().int().min(0).max(6)).min(1),
        openHour: z.number().int().min(0).max(23).default(9),
        closeHour: z.number().int().min(1).max(24).default(17),
        holidays: z.array(z.string()).optional(),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db
      .select()
      .from(crmConfigTable)
      .where(eq(crmConfigTable.key, "business_calendar"))
      .limit(1);
    const row = await createGovernedDraft({
      entityType: "business_calendar",
      entityId: "business_calendar",
      authorStaffId: req.platformStaff!.id,
      beforeValue: (current?.value as Record<string, unknown>) ?? null,
      afterValue: {
        timeZone: parsed.timeZone,
        weekdays: parsed.weekdays,
        openHour: parsed.openHour,
        closeHour: parsed.closeHour,
        holidays: parsed.holidays ?? [],
      },
      rationale: parsed.rationale ?? "business calendar update",
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/retention-policy", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        retainDays: z.number().int().min(1).max(3650),
        anonymizeMessages: z.boolean().default(true),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db
      .select()
      .from(crmConfigTable)
      .where(eq(crmConfigTable.key, "retention_policy"))
      .limit(1);
    const row = await createGovernedDraft({
      entityType: "retention_policy",
      entityId: "retention_policy",
      authorStaffId: req.platformStaff!.id,
      beforeValue: (current?.value as Record<string, unknown>) ?? null,
      afterValue: {
        retainDays: parsed.retainDays,
        anonymizeMessages: parsed.anonymizeMessages,
      },
      rationale: parsed.rationale ?? "retention policy update",
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.put("/platform/contact/spam-bot-policy", requirePermission("config.propose"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        blockScore: z.number().min(0).max(100),
        honeypotReject: z.boolean().default(true),
        rationale: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const [current] = await db
      .select()
      .from(crmConfigTable)
      .where(eq(crmConfigTable.key, "spam_bot_policy"))
      .limit(1);
    const row = await createGovernedDraft({
      entityType: "spam_bot_policy",
      entityId: "spam_bot_policy",
      authorStaffId: req.platformStaff!.id,
      beforeValue: (current?.value as Record<string, unknown>) ?? null,
      afterValue: {
        blockScore: parsed.blockScore,
        honeypotReject: parsed.honeypotReject,
      },
      rationale: parsed.rationale ?? "spam/bot policy update",
    });
    res.status(201).json({ changeId: row.id, status: "draft", message: "Governed draft created." });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/platform/contact/inquiries/:id/sla/pause",
  requirePermission("inquiries.status"),
  async (req, res, next) => {
    try {
      const count = await pauseInquirySla(pid(req));
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "sla.pause",
        entityType: "inquiry",
        entityId: pid(req),
        inquiryId: pid(req),
      });
      res.json({ paused: count });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/inquiries/:id/sla/resume",
  requirePermission("inquiries.status"),
  async (req, res, next) => {
    try {
      const count = await resumeInquirySla(pid(req));
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "sla.resume",
        entityType: "inquiry",
        entityId: pid(req),
        inquiryId: pid(req),
      });
      res.json({ resumed: count });
    } catch (err) {
      next(err);
    }
  },
);

router.post("/platform/contact/contacts/merge", requirePermission("inquiries.delete"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        winnerId: z.string().uuid(),
        loserId: z.string().uuid(),
        idempotencyKey: z.string().min(8).max(80),
      })
      .parse(req.body ?? {});
    const result = await applyContactMerge({
      winnerId: parsed.winnerId,
      loserId: parsed.loserId,
      actorStaffId: req.platformStaff!.id,
      idempotencyKey: parsed.idempotencyKey,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/contacts/duplicates", requirePermission("inquiries.view"), async (req, res, next) => {
  try {
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
    const phone = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
    if (!email && !phone) {
      res.status(400).json({ error: "email or phone query is required" });
      return;
    }
    const filters: SQL[] = [];
    if (email) filters.push(eq(crmContactsTable.emailNormalized, email));
    if (phone) filters.push(eq(crmContactsTable.phoneE164, phone));
    const rows = await db
      .select({
        id: crmContactsTable.id,
        email: crmContactsTable.email,
        firstName: crmContactsTable.firstName,
        lastName: crmContactsTable.lastName,
        phoneE164: crmContactsTable.phoneE164,
        companyId: crmContactsTable.companyId,
        updatedAt: crmContactsTable.updatedAt,
      })
      .from(crmContactsTable)
      .where(or(...filters)!)
      .orderBy(desc(crmContactsTable.updatedAt))
      .limit(50);
    res.json({ items: rows, matchOn: { email: email || null, phone: phone || null } });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/jobs", requirePermission("jobs.inspect"), async (req, res, next) => {
  try {
    const limit = boundedPageSize(req.query.limit, 100, 200);
    const cursor = typeof req.query.cursor === "string" ? decodeTimeIdCursor(req.query.cursor) : null;
    const where = cursor
      ? or(
          lt(crmJobsTable.createdAt, cursor.createdAt),
          and(eq(crmJobsTable.createdAt, cursor.createdAt), lt(crmJobsTable.id, cursor.id)),
        )
      : undefined;
    const items = await db
      .select()
      .from(crmJobsTable)
      .where(where)
      .orderBy(desc(crmJobsTable.createdAt), desc(crmJobsTable.id))
      .limit(limit);
    const last = items[items.length - 1];
    const nextCursor =
      last && items.length === limit ? encodeTimeIdCursor({ createdAt: last.createdAt, id: last.id }) : null;
    res.json({ items, nextCursor, limit });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/jobs/dead", requirePermission("jobs.inspect"), async (req, res, next) => {
  try {
    const items = await listDeadLetterJobs({
      limit: Number(req.query.limit ?? 100),
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      type: typeof req.query.type === "string" ? req.query.type : undefined,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/jobs/:id/replay", requirePermission("jobs.replay"), async (req, res, next) => {
  try {
    const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const ok = await replayDeadLetterJob({
      jobId: pid(req),
      actorStaffId: req.platformStaff!.id,
      reason: parsed.data.reason,
    });
    if (!ok) {
      res.status(409).json({ error: "Job is not in dead-letter or was already replayed" });
      return;
    }
    await writeAudit({
      actorType: "staff",
      actorId: req.platformStaff!.id,
      action: "job.replayed",
      entityType: "job",
      entityId: pid(req),
    });
    res.json({ replayed: true, id: pid(req) });
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
    const staff = req.platformStaff!;
    const memberTeams = await db
      .select({ teamId: crmTeamMembersTable.teamId })
      .from(crmTeamMembersTable)
      .where(eq(crmTeamMembersTable.staffId, staff.id));
    const teamIds = memberTeams.map((t) => t.teamId);
    const rows = await db
      .select()
      .from(crmSavedViewsTable)
      .where(
        or(
          eq(crmSavedViewsTable.staffId, staff.id),
          eq(crmSavedViewsTable.scope, "shared"),
          teamIds.length
            ? and(eq(crmSavedViewsTable.scope, "team"), inArray(crmSavedViewsTable.teamId, teamIds))
            : undefined,
        )!,
      );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/saved-views", requirePermission("inquiries.view"), async (req, res, next) => {
  try {
    const staff = req.platformStaff!;
    const parsed = z
      .object({
        name: z.string().min(1).max(80),
        filters: z.record(z.unknown()),
        isDefault: z.boolean().optional(),
        scope: z.enum(["personal", "team", "shared"]).optional(),
        teamId: z.string().uuid().optional(),
        columns: z.array(z.string()).optional(),
        sort: z.record(z.unknown()).optional(),
      })
      .parse(req.body ?? {});
    const scope = parsed.scope ?? "personal";
    if (scope === "shared" && !hasPermission(staff.permissions, "config.manage")) {
      res.status(403).json({ error: "Shared saved views require config.manage" });
      return;
    }
    if (scope === "team") {
      if (!parsed.teamId) {
        res.status(400).json({ error: "teamId required for team scope" });
        return;
      }
      const [membership] = await db
        .select({ teamId: crmTeamMembersTable.teamId })
        .from(crmTeamMembersTable)
        .where(
          and(
            eq(crmTeamMembersTable.staffId, staff.id),
            eq(crmTeamMembersTable.teamId, parsed.teamId),
          ),
        )
        .limit(1);
      if (!membership) {
        res.status(403).json({ error: "Not a member of that team" });
        return;
      }
    }
    if (parsed.isDefault) {
      await db
        .update(crmSavedViewsTable)
        .set({ isDefault: false })
        .where(eq(crmSavedViewsTable.staffId, staff.id));
    }
    const [row] = await db
      .insert(crmSavedViewsTable)
      .values({
        staffId: staff.id,
        name: parsed.name,
        filters: parsed.filters,
        columns: parsed.columns,
        sort: parsed.sort,
        isDefault: parsed.isDefault ?? false,
        scope,
        teamId: scope === "team" ? parsed.teamId : null,
        version: 1,
        updatedBy: staff.id,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.get(
  "/platform/contact/saved-views/:id",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const [row] = await db
        .select()
        .from(crmSavedViewsTable)
        .where(
          and(
            eq(crmSavedViewsTable.id, String(req.params.id)),
            eq(crmSavedViewsTable.staffId, req.platformStaff!.id),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Saved view not found" });
        return;
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/platform/contact/saved-views/:id",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const staff = req.platformStaff!;
      const parsed = z
        .object({
          name: z.string().min(1).max(80).optional(),
          filters: z.record(z.unknown()).optional(),
          isDefault: z.boolean().optional(),
          columns: z.array(z.string()).optional(),
          sort: z.record(z.unknown()).optional(),
          expectedVersion: z.number().int().positive().optional(),
          transferToStaffId: z.string().uuid().optional(),
        })
        .parse(req.body ?? {});
      const [existing] = await db
        .select()
        .from(crmSavedViewsTable)
        .where(eq(crmSavedViewsTable.id, String(req.params.id)))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Saved view not found" });
        return;
      }
      const isOwner = existing.staffId === staff.id;
      const canManageShared =
        existing.scope === "shared" && hasPermission(staff.permissions, "config.manage");
      if (!isOwner && !canManageShared) {
        res.status(403).json({ error: "Only owner (or config.manage for shared) may update" });
        return;
      }
      if (parsed.expectedVersion != null && existing.version !== parsed.expectedVersion) {
        res.status(409).json({
          error: "Saved view version conflict",
          currentVersion: existing.version,
        });
        return;
      }
      if (parsed.isDefault) {
        await db
          .update(crmSavedViewsTable)
          .set({ isDefault: false })
          .where(eq(crmSavedViewsTable.staffId, staff.id));
      }
      const [row] = await db
        .update(crmSavedViewsTable)
        .set({
          ...(parsed.name ? { name: parsed.name } : {}),
          ...(parsed.filters ? { filters: parsed.filters } : {}),
          ...(parsed.columns ? { columns: parsed.columns } : {}),
          ...(parsed.sort ? { sort: parsed.sort } : {}),
          ...(parsed.isDefault != null ? { isDefault: parsed.isDefault } : {}),
          ...(parsed.transferToStaffId && isOwner
            ? { staffId: parsed.transferToStaffId }
            : {}),
          version: existing.version + 1,
          updatedAt: new Date(),
          updatedBy: staff.id,
        })
        .where(
          and(
            eq(crmSavedViewsTable.id, existing.id),
            eq(crmSavedViewsTable.version, existing.version),
          ),
        )
        .returning();
      if (!row) {
        res.status(409).json({ error: "Saved view version conflict" });
        return;
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/platform/contact/saved-views/:id",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const deleted = await db
        .delete(crmSavedViewsTable)
        .where(
          and(
            eq(crmSavedViewsTable.id, String(req.params.id)),
            eq(crmSavedViewsTable.staffId, req.platformStaff!.id),
          ),
        )
        .returning({ id: crmSavedViewsTable.id });
      if (!deleted.length) {
        res.status(404).json({ error: "Saved view not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

router.get("/platform/contact/analytics", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const window = parseAnalyticsWindow(req.query);
    const inquiryRange = and(
      window.from ? gte(crmInquiriesTable.createdAt, window.from) : undefined,
      window.to ? lte(crmInquiriesTable.createdAt, window.to) : undefined,
    );
    const eventRange = and(
      window.from ? gte(crmAnalyticsEventsTable.createdAt, window.from) : undefined,
      window.to ? lte(crmAnalyticsEventsTable.createdAt, window.to) : undefined,
    );
    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) filter (where qualification_status in ('SALES_QUALIFIED','HIGH_PRIORITY'))::int`,
        open: sql<number>`count(*) filter (where status not in ('CLOSED','RESOLVED','SPAM','CANCELLED'))::int`,
        sales: sql<number>`count(*) filter (where inquiry_type = 'sales')::int`,
        support: sql<number>`count(*) filter (where inquiry_type in ('technical','billing'))::int`,
        aging7d: sql<number>`count(*) filter (where last_activity_at < now() - interval '7 days' and status not in ('CLOSED','RESOLVED','SPAM','CANCELLED'))::int`,
      })
      .from(crmInquiriesTable)
      .where(inquiryRange);
    const byCountry = await db
      .select({
        country: crmContactsTable.country,
        count: sql<number>`count(*)::int`,
      })
      .from(crmInquiriesTable)
      .innerJoin(crmContactsTable, eq(crmContactsTable.id, crmInquiriesTable.contactId))
      .where(inquiryRange)
      .groupBy(crmContactsTable.country)
      .orderBy(sql`count(*) desc`)
      .limit(25);
    const byInquiryType = await db
      .select({
        inquiryType: crmInquiriesTable.inquiryType,
        count: sql<number>`count(*)::int`,
      })
      .from(crmInquiriesTable)
      .where(inquiryRange)
      .groupBy(crmInquiriesTable.inquiryType);
    const byQualification = await db
      .select({
        status: crmInquiriesTable.qualificationStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(crmInquiriesTable)
      .where(inquiryRange)
      .groupBy(crmInquiriesTable.qualificationStatus);
    const events = await db
      .select({
        event: crmAnalyticsEventsTable.event,
        count: sql<number>`count(*)::int`,
      })
      .from(crmAnalyticsEventsTable)
      .where(eventRange)
      .groupBy(crmAnalyticsEventsTable.event);
    const [sla] = await db
      .select({
        breached: sql<number>`count(*) filter (where status = 'BREACHED')::int`,
        onTrack: sql<number>`count(*) filter (where status = 'ON_TRACK')::int`,
        atRisk: sql<number>`count(*) filter (where status = 'AT_RISK')::int`,
        completed: sql<number>`count(*) filter (where status = 'COMPLETED')::int`,
        paused: sql<number>`count(*) filter (where status = 'PAUSED')::int`,
      })
      .from(crmSlaInstancesTable);
    const [jobs] = await db
      .select({
        pending: sql<number>`count(*) filter (where status = 'pending')::int`,
        running: sql<number>`count(*) filter (where status = 'running')::int`,
        dead: sql<number>`count(*) filter (where status = 'dead')::int`,
      })
      .from(crmJobsTable);
    const [workload] = await db
      .select({
        assigned: sql<number>`count(*) filter (where assigned_staff_id is not null)::int`,
        unassigned: sql<number>`count(*) filter (where assigned_staff_id is null)::int`,
      })
      .from(crmInquiriesTable)
      .where(inquiryRange);
    const definitions = {
      qualified:
        "Inquiries with qualification_status in (SALES_QUALIFIED, HIGH_PRIORITY). Denominator: all inquiries in the selected window.",
      slaBreached: "SLA instances with status BREACHED. Denominator: all SLA instances (not windowed; clocks span inquiries).",
      timeZone: window.timeZone,
      dateRange: `${window.from?.toISOString() ?? "unbounded"} → ${window.to?.toISOString() ?? "unbounded"}`,
      funnelCreated: "Count of analytics events named inquiry_created or qualified (submit) in the window.",
      funnelQualified: "Count of analytics events named qualified in the window.",
      funnelMeetings: "Count of meeting rows (offered) vs bookingStatus BOOKED.",
      formAbandonment:
        "form_view events minus inquiry count. Rate is abandoned / form_view when form_view > 0.",
      backlogAging: "Open inquiries whose last_activity_at is older than 7 days. Denominator: open inquiries in window.",
      workload: "Assigned vs unassigned inquiries in the window.",
      templateEffectiveness: "template_used analytics events in the window (if instrumented).",
      workflowEffectiveness: "workflow_matched vs workflow_failed analytics events in the window.",
    };
    const eventMap = Object.fromEntries(events.map((e) => [e.event, e.count]));
    const [meetings] = await db
      .select({
        offered: sql<number>`count(*)::int`,
        booked: sql<number>`count(*) filter (where booking_status = 'BOOKED')::int`,
      })
      .from(crmMeetingsTable);
    const formViews = Number(eventMap.form_view ?? 0);
    const submits = Number(totals.total ?? 0);
    const abandoned = Math.max(0, formViews - submits);
    const funnel = {
      created: Number(eventMap.inquiry_created ?? 0) + Number(eventMap.qualified ?? 0),
      qualified: Number(eventMap.qualified ?? 0),
      meetingOffered: meetings?.offered ?? 0,
      meetingBooked: meetings?.booked ?? 0,
    };
    const abandonment = {
      formViews,
      submits,
      abandoned,
      rate: formViews > 0 ? Math.round((abandoned / formViews) * 1000) / 10 : null,
    };
    const payload = {
      totals,
      byCountry,
      byInquiryType,
      byQualification,
      events,
      sla,
      jobs,
      funnel,
      abandonment,
      workload,
      window,
      definitions,
    };
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

const lockEntitySchema = z.object({
  entityType: z.enum(["inquiry", "marketing_version", "config_change"]),
  entityId: z.string().uuid(),
  intent: z.string().max(40).optional(),
});

router.post("/platform/contact/locks/acquire", requirePermission("inquiries.view"), async (req, res, next) => {
  try {
    const parsed = lockEntitySchema.parse(req.body ?? {});
    const staffId = req.platformStaff!.id;
    const lock = await acquireLock({
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      staffId,
      intent: parsed.intent,
    });
    await heartbeatPresence({
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      staffId,
      intent: parsed.intent ?? "edit",
    });
    res.status(201).json({ lock });
  } catch (err) {
    if (err instanceof RecordLockConflictError) {
      res.status(409).json({ error: err.message, code: err.code, holder: err.holder });
      return;
    }
    httpError(err, res, next);
  }
});

router.post(
  "/platform/contact/locks/:id/heartbeat",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const lock = await heartbeatLock({ lockId: pid(req), staffId: req.platformStaff!.id });
      res.json({ lock });
    } catch (err) {
      httpError(err, res, next);
    }
  },
);

router.post(
  "/platform/contact/locks/:id/release",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const result = await releaseLock({ lockId: pid(req), staffId: req.platformStaff!.id });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/platform/contact/locks/:id/override",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body ?? {});
      const [existing] = await db
        .select()
        .from(crmRecordLocksTable)
        .where(eq(crmRecordLocksTable.id, pid(req)))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Lock not found" });
        return;
      }
      const staff = req.platformStaff!;
      const permissions =
        staff.permissions && staff.permissions.length > 0 ? staff.permissions : (ROLE_PERMISSIONS[staff.role] ?? []);
      const lock = await overrideLock({
        entityType: existing.entityType as RecordLockEntityType,
        entityId: existing.entityId,
        staffId: staff.id,
        reason: parsed.reason,
        permissions,
      });
      res.json({ lock });
    } catch (err) {
      httpError(err, res, next);
    }
  },
);

router.post(
  "/platform/contact/presence/heartbeat",
  requirePermission("inquiries.view"),
  async (req, res, next) => {
    try {
      const parsed = lockEntitySchema.parse(req.body ?? {});
      const presence = await heartbeatPresence({
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        staffId: req.platformStaff!.id,
        intent: parsed.intent ?? "view",
      });
      res.json({ presence });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/platform/contact/presence", requirePermission("inquiries.view"), async (req, res, next) => {
  try {
    const entityType = String(req.query.entityType ?? "");
    const entityId = String(req.query.entityId ?? "");
    if (!isRecordLockEntityType(entityType) || !entityId) {
      res.status(400).json({ error: "entityType and entityId query params are required" });
      return;
    }
    const snapshot = await listPresence({ entityType, entityId });
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
});

router.post("/platform/contact/exports", requirePermission("inquiries.export"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        filters: z.record(z.string(), z.unknown()).optional(),
        columns: z.array(z.string().max(64)).max(40).optional(),
      })
      .parse(req.body ?? {});
    const job = await enqueueExport({
      staffId: req.platformStaff!.id,
      filters: parsed.filters,
      columns: parsed.columns,
    });
    res.status(202).json({ job });
  } catch (err) {
    httpError(err, res, next);
  }
});

router.get("/platform/contact/exports", requirePermission("inquiries.export"), async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const jobs = await listExports(req.platformStaff!.id, Number.isFinite(limit) ? limit : 50);
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

router.get("/platform/contact/exports/:id", requirePermission("inquiries.export"), async (req, res, next) => {
  try {
    const job = await getExport({ exportJobId: pid(req), staffId: req.platformStaff!.id });
    res.json({ job });
  } catch (err) {
    httpError(err, res, next);
  }
});

router.post(
  "/platform/contact/exports/:id/cancel",
  requirePermission("inquiries.export"),
  async (req, res, next) => {
    try {
      const job = await cancelExport({ exportJobId: pid(req), staffId: req.platformStaff!.id });
      res.json({ job });
    } catch (err) {
      httpError(err, res, next);
    }
  },
);

router.get(
  "/platform/contact/exports/:id/download",
  requirePermission("inquiries.export"),
  async (req, res, next) => {
    try {
      const { filePath, filename } = await getDownload({
        exportJobId: pid(req),
        staffId: req.platformStaff!.id,
      });
      await writeAudit({
        actorType: "staff",
        actorId: req.platformStaff!.id,
        action: "export.downloaded",
        entityType: "export_job",
        entityId: pid(req),
        afterValue: { filename },
      });
      const json = filename.endsWith(".json");
      res.setHeader("Content-Type", json ? "application/json; charset=utf-8" : "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      createReadStream(filePath).on("error", (err) => httpError(err, res, next)).pipe(res);
    } catch (err) {
      httpError(err, res, next);
    }
  },
);

export default router;
