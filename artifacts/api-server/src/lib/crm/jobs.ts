import {
  db,
  crmJobsTable,
  crmInquiriesTable,
  crmContactsTable,
  crmCompaniesTable,
  crmMessagesTable,
  crmConversationsTable,
  crmTemplatesTable,
  crmTemplateVersionsTable,
  crmMeetingsTable,
  crmMeetingTypesTable,
  crmStaffTable,
  crmTagsTable,
  crmInquiryTagsTable,
  crmNotificationsTable,
  crmWorkflowsTable,
  crmWorkflowExecutionsTable,
  crmAnalyticsEventsTable,
  crmAiClassificationsTable,
  crmSlaInstancesTable,
} from "@workspace/db";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { logger } from "../logger";
import { sendTransactionalEmail } from "../email";
import { renderTemplate, textToHtml } from "./templates";
import { writeAudit } from "./audit";
import { matchAllConditions, type Condition } from "./conditions";
import { heuristicClassify } from "./ai";

const backoffMs = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export async function enqueueJob(
  type: string,
  payload: Record<string, unknown>,
  opts?: { correlationId?: string; runAt?: Date },
): Promise<void> {
  await db.insert(crmJobsTable).values({
    type,
    payload,
    correlationId: opts?.correlationId ?? null,
    runAt: opts?.runAt ?? new Date(),
  });
}

export async function processCrmJobs(limit = 10): Promise<void> {
  const jobs = await db
    .select()
    .from(crmJobsTable)
    .where(
      and(eq(crmJobsTable.status, "pending"), lte(crmJobsTable.runAt, new Date())),
    )
    .limit(limit);

  for (const job of jobs) {
    const claimed = await db
      .update(crmJobsTable)
      .set({ status: "running", attempts: sql`${crmJobsTable.attempts} + 1` })
      .where(and(eq(crmJobsTable.id, job.id), eq(crmJobsTable.status, "pending")))
      .returning({ id: crmJobsTable.id });
    if (claimed.length === 0) continue;
    try {
      await handleJob(job.type, job.payload as Record<string, unknown>, job.correlationId);
      await db
        .update(crmJobsTable)
        .set({ status: "completed", completedAt: new Date(), lastError: null })
        .where(eq(crmJobsTable.id, job.id));
    } catch (err) {
      const attempts = job.attempts + 1;
      const giveUp = attempts >= job.maxAttempts;
      const delay = backoffMs[Math.min(attempts - 1, backoffMs.length - 1)];
      logger.error({ err, jobId: job.id, type: job.type }, "crm job failed");
      await db
        .update(crmJobsTable)
        .set({
          status: giveUp ? "dead" : "pending",
          lastError: err instanceof Error ? err.message : "job failed",
          runAt: new Date(Date.now() + delay),
        })
        .where(eq(crmJobsTable.id, job.id));
    }
  }
}

async function handleJob(
  type: string,
  payload: Record<string, unknown>,
  correlationId: string | null,
): Promise<void> {
  switch (type) {
    case "send_acknowledgment":
      await sendInquiryEmail(String(payload.inquiryId), String(payload.templateKey));
      break;
    case "notify_staff":
      await notifyStaff(payload);
      break;
    case "analytics":
      await db.insert(crmAnalyticsEventsTable).values({
        event: String(payload.event),
        inquiryId: typeof payload.inquiryId === "string" ? payload.inquiryId : null,
        contactId: typeof payload.contactId === "string" ? payload.contactId : null,
        properties: (payload.properties as Record<string, unknown>) ?? {},
      });
      break;
    case "ai_classify":
      await runAiClassify(String(payload.inquiryId));
      break;
    case "run_workflows":
      await runWorkflows(String(payload.trigger), String(payload.inquiryId), correlationId);
      break;
    case "refresh_sla":
      await refreshSlaStatuses();
      break;
    default:
      logger.warn({ type }, "unknown crm job type");
  }
}

export async function loadInquiryContext(inquiryId: string) {
  const [inquiry] = await db
    .select()
    .from(crmInquiriesTable)
    .where(eq(crmInquiriesTable.id, inquiryId))
    .limit(1);
  if (!inquiry) return null;
  const [contact] = await db
    .select()
    .from(crmContactsTable)
    .where(eq(crmContactsTable.id, inquiry.contactId))
    .limit(1);
  const [company] = inquiry.companyId
    ? await db
        .select()
        .from(crmCompaniesTable)
        .where(eq(crmCompaniesTable.id, inquiry.companyId))
        .limit(1)
    : [null];
  const [owner] = inquiry.assignedStaffId
    ? await db
        .select()
        .from(crmStaffTable)
        .where(eq(crmStaffTable.id, inquiry.assignedStaffId))
        .limit(1)
    : [null];
  const [meeting] = await db
    .select()
    .from(crmMeetingsTable)
    .where(eq(crmMeetingsTable.inquiryId, inquiryId))
    .limit(1);
  return { inquiry, contact, company, owner, meeting };
}

export function mergeVarsFor(ctx: NonNullable<Awaited<ReturnType<typeof loadInquiryContext>>>) {
  return {
    contact: {
      first_name: ctx.contact?.firstName,
      last_name: ctx.contact?.lastName,
      company_name: ctx.company?.name,
    },
    company: { name: ctx.company?.name ?? "" },
    inquiry: {
      reference: ctx.inquiry.reference,
      use_case: (ctx.inquiry.useCaseKeys ?? []).join(", "),
      created_at: ctx.inquiry.createdAt.toISOString(),
    },
    owner: {
      name: ctx.owner?.name ?? "the ClaimTagX team",
      email: ctx.owner?.email ?? "",
    },
    meeting: {
      booking_url: ctx.meeting?.bookingUrl ?? "",
    },
    company_support: { support_email: "sales@claimtagx.com" },
  };
}

export async function sendInquiryEmail(
  inquiryId: string,
  templateKey: string,
  extra?: { body?: string },
): Promise<{ messageId: string } | null> {
  const ctx = await loadInquiryContext(inquiryId);
  if (!ctx?.contact) return null;
  const [template] = await db
    .select()
    .from(crmTemplatesTable)
    .where(and(eq(crmTemplatesTable.key, templateKey), eq(crmTemplatesTable.status, "published")))
    .limit(1);
  if (!template) throw new Error(`Template ${templateKey} is not published`);
  const [conversation] = await db
    .select({ id: crmConversationsTable.id })
    .from(crmConversationsTable)
    .where(eq(crmConversationsTable.inquiryId, inquiryId))
    .limit(1);
  if (!conversation) throw new Error("Conversation not found");
  const [version] = await db
    .select()
    .from(crmTemplateVersionsTable)
    .where(eq(crmTemplateVersionsTable.templateId, template.id))
    .orderBy(desc(crmTemplateVersionsTable.versionNumber))
    .limit(1);
  if (!version) throw new Error(`Template ${templateKey} has no version`);
  const vars = mergeVarsFor(ctx) as Record<string, unknown>;
  (vars as { body?: string }).body = extra?.body ?? "";
  const subject = renderTemplate(version.subject, vars as never).text;
  const body = renderTemplate(version.body, vars as never).text;
  await sendTransactionalEmail({
    to: ctx.contact.email,
    subject,
    text: body,
    html: `<div style="font-family:Inter,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b1220">${textToHtml(body)}</div>`,
  });
  const [msg] = await db
    .insert(crmMessagesTable)
    .values({
      conversationId: conversation.id,
      inquiryId,
      kind: "automated_acknowledgment",
      visibility: "customer",
      channel: "email",
      authorType: "system",
      subject,
      body,
      bodyHtml: textToHtml(body),
      templateId: template.id,
      templateVersionId: version.id,
    })
    .returning({ id: crmMessagesTable.id });
  return { messageId: msg.id };
}

async function notifyStaff(payload: Record<string, unknown>): Promise<void> {
  const staffId = String(payload.staffId ?? "");
  if (!staffId) return;
  await db.insert(crmNotificationsTable).values({
    staffId,
    inquiryId: typeof payload.inquiryId === "string" ? payload.inquiryId : null,
    type: String(payload.type ?? "notice"),
    title: String(payload.title ?? "Notification"),
    body: typeof payload.body === "string" ? payload.body : null,
  });
}

async function runAiClassify(inquiryId: string): Promise<void> {
  const [msg] = await db
    .select()
    .from(crmMessagesTable)
    .where(
      and(eq(crmMessagesTable.inquiryId, inquiryId), eq(crmMessagesTable.kind, "web_form")),
    )
    .limit(1);
  const output = heuristicClassify(msg?.body ?? "");
  await db.insert(crmAiClassificationsTable).values({
    inquiryId,
    provider: "heuristic",
    model: "keyword-v1",
    confidence: output.confidence,
    output: output as unknown as Record<string, unknown>,
  });
  await writeAudit({
    actorType: "system",
    action: "ai.classified",
    entityType: "inquiry",
    entityId: inquiryId,
    inquiryId,
    afterValue: output as unknown as Record<string, unknown>,
  });
}

export async function addTag(inquiryId: string, slug: string): Promise<void> {
  const [tag] = await db
    .select()
    .from(crmTagsTable)
    .where(eq(crmTagsTable.slug, slug))
    .limit(1);
  const resolved =
    tag ??
    (
      await db
        .insert(crmTagsTable)
        .values({ slug, label: slug.replace(/_/g, " ") })
        .onConflictDoNothing({ target: crmTagsTable.slug })
        .returning()
    )[0];
  const finalTag =
    resolved ??
    (await db.select().from(crmTagsTable).where(eq(crmTagsTable.slug, slug)).limit(1))[0];
  if (!finalTag) return;
  await db
    .insert(crmInquiryTagsTable)
    .values({ inquiryId, tagId: finalTag.id })
    .onConflictDoNothing();
}

export async function generateMeetingInvitation(inquiryId: string): Promise<string | null> {
  const ctx = await loadInquiryContext(inquiryId);
  if (!ctx) return null;
  const [existing] = await db
    .select()
    .from(crmMeetingsTable)
    .where(eq(crmMeetingsTable.inquiryId, inquiryId))
    .limit(1);
  if (existing) return existing.bookingUrl;
  const [type] = await db
    .select()
    .from(crmMeetingTypesTable)
    .where(eq(crmMeetingTypesTable.status, "active"))
    .limit(1);
  if (!type) return null;
  const url = new URL(type.bookingUrl);
  if (ctx.contact) {
    url.searchParams.set("name", `${ctx.contact.firstName} ${ctx.contact.lastName}`);
    url.searchParams.set("email", ctx.contact.email);
  }
  url.searchParams.set("a1", ctx.inquiry.reference);
  const bookingUrl = url.toString();
  await db.insert(crmMeetingsTable).values({
    inquiryId,
    contactId: ctx.inquiry.contactId,
    meetingTypeId: type.id,
    assignedStaffId: ctx.inquiry.assignedStaffId,
    assignedTeamId: ctx.inquiry.assignedTeamId,
    bookingUrl,
    bookingStatus: "INVITED",
    timezone: type.timezone,
  });
  await db
    .update(crmInquiriesTable)
    .set({ meetingOfferedAt: new Date(), updatedAt: new Date() })
    .where(eq(crmInquiriesTable.id, inquiryId));
  await writeAudit({
    actorType: "system",
    action: "meeting.invited",
    entityType: "inquiry",
    entityId: inquiryId,
    inquiryId,
    afterValue: { bookingUrl },
  });
  return bookingUrl;
}

async function runWorkflows(
  trigger: string,
  inquiryId: string,
  correlationId: string | null,
): Promise<void> {
  const workflows = await db
    .select()
    .from(crmWorkflowsTable)
    .where(and(eq(crmWorkflowsTable.status, "active"), eq(crmWorkflowsTable.trigger, trigger)));
  const ctx = await loadInquiryContext(inquiryId);
  if (!ctx) return;
  const { isImmediatelyQualified } = await import("./qualification");
  const facts = {
    qualification: {
      status: ctx.inquiry.qualificationStatus,
      score: ctx.inquiry.qualificationScore,
      immediatelyQualified: isImmediatelyQualified(ctx.inquiry.qualificationStatus),
    },
    country: ctx.contact?.country,
    source: ctx.inquiry.source,
  };
  for (const wf of workflows) {
    const idempotencyKey = `${wf.id}:${wf.version}:${trigger}:${inquiryId}`;
    const match = matchAllConditions(facts, (wf.conditions ?? []) as unknown as Condition[]);
    const [exec] = await db
      .insert(crmWorkflowExecutionsTable)
      .values({
        workflowId: wf.id,
        workflowVersion: wf.version,
        inquiryId,
        trigger,
        matched: { conditions: match.matched, ok: match.ok },
        status: match.ok ? "running" : "skipped",
        idempotencyKey,
      })
      .onConflictDoNothing({ target: crmWorkflowExecutionsTable.idempotencyKey })
      .returning();
    if (!exec || !match.ok) continue;
    try {
      for (const action of wf.actions as Array<{ type: string; params?: Record<string, unknown> }>) {
        await applyAction(inquiryId, action, wf.id, correlationId);
      }
      await db
        .update(crmWorkflowExecutionsTable)
        .set({ status: "completed" })
        .where(eq(crmWorkflowExecutionsTable.id, exec.id));
      await writeAudit({
        actorType: "workflow",
        action: "workflow.executed",
        entityType: "inquiry",
        entityId: inquiryId,
        inquiryId,
        workflowId: wf.id,
        correlationId,
        afterValue: { workflow: wf.name, version: wf.version, matched: match.matched },
      });
    } catch (err) {
      await db
        .update(crmWorkflowExecutionsTable)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : "failed",
        })
        .where(eq(crmWorkflowExecutionsTable.id, exec.id));
    }
  }
}

async function applyAction(
  inquiryId: string,
  action: { type: string; params?: Record<string, unknown> },
  workflowId: string,
  correlationId: string | null,
): Promise<void> {
  const params = action.params ?? {};
  switch (action.type) {
    case "send_template":
      await sendInquiryEmail(inquiryId, String(params.key));
      break;
    case "set_priority":
      await db
        .update(crmInquiriesTable)
        .set({ priority: String(params.priority), updatedAt: new Date() })
        .where(eq(crmInquiriesTable.id, inquiryId));
      break;
    case "change_status":
      await db
        .update(crmInquiriesTable)
        .set({ status: String(params.status), updatedAt: new Date() })
        .where(eq(crmInquiriesTable.id, inquiryId));
      break;
    case "add_tag":
      await addTag(inquiryId, String(params.slug));
      break;
    case "generate_meeting":
      await generateMeetingInvitation(inquiryId);
      break;
    case "notify_assignee": {
      const [inq] = await db
        .select()
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.id, inquiryId))
        .limit(1);
      if (inq?.assignedStaffId) {
        await notifyStaff({
          staffId: inq.assignedStaffId,
          inquiryId,
          type: String(params.type ?? "assigned"),
          title: "Qualified lead received",
          body: inq.reference,
        });
      }
      break;
    }
    default:
      logger.warn({ action: action.type, workflowId, correlationId }, "unknown workflow action");
  }
}

async function refreshSlaStatuses(): Promise<void> {
  const now = new Date();
  const open = await db
    .select()
    .from(crmSlaInstancesTable)
    .where(eq(crmSlaInstancesTable.status, "ON_TRACK"));
  for (const row of open) {
    const msLeft = row.dueAt.getTime() - now.getTime();
    let status = row.status;
    if (msLeft <= 0) status = "BREACHED";
    else if (msLeft < 60 * 60 * 1000) status = "AT_RISK";
    if (status !== row.status) {
      await db
        .update(crmSlaInstancesTable)
        .set({ status })
        .where(eq(crmSlaInstancesTable.id, row.id));
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startCrmJobWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    processCrmJobs().catch((err) => logger.error({ err }, "crm job worker tick failed"));
  }, 2000);
  void processCrmJobs();
}
