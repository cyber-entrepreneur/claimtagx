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
  crmOutboundSendsTable,
  type DbSession,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { evaluateClock } from "./slaCalendar";
import { logger } from "../logger";
import { sendTransactionalEmail } from "../email";
import { renderTemplate, textToHtml } from "./templates";
import { writeAudit } from "./audit";
import { matchAllConditions, type Condition } from "./conditions";
import { heuristicClassify } from "./ai";
import { buildThreadingHeaders, type ThreadParent } from "./emailThreading";
import { bookingUrlForAudit, parseGovernedBookingUrl } from "./bookingUrl";
import { extractMailDomain } from "./emailProvider";
import { escalationForClock } from "./slaEscalation";
import {
  claimJobs,
  completeJob,
  createWorkerId,
  enqueueJob,
  failJob,
  LostOwnershipError,
  queueMetrics,
  releaseUnstartedJobs,
  scheduleRecurringSlaRefresh,
  scheduleRecurringRetention,
  scheduleGraphMailMaintenance,
  scheduleMarketingPublishDue,
  withJobHeartbeat,
  assertJobOwned,
  delayIfTestJob,
  stillOwnsJob,
  activeHandlerAborts,
  type JobRunContext,
} from "./queue";
import {
  applyTransactionalDbEffect,
  claimEffectForWork,
  commitEffect,
  emailEffectKey,
  failEffect,
  insertPendingEffect,
  transitionEffect,
  type EffectLease,
} from "./effects";
import { simulatedProviderSend } from "./emailSimulator";
import {
  jobConcurrencyKey,
  jobPipelineMetrics,
  jobTypeConcurrencyLimit,
  pipelineSaturation,
  recordJobPipelineEvent,
  workerConcurrency,
} from "./jobPipeline";

export { enqueueJob, queueMetrics } from "./queue";

const workerId = createWorkerId();

export class UnknownJobTypeError extends Error {
  constructor(type: string) {
    super(`unknown crm job type: ${type}`);
    this.name = "UnknownJobTypeError";
  }
}

export async function processCrmJobs(
  limit = 10,
  opts?: { workerId?: string; shuttingDown?: () => boolean },
): Promise<void> {
  const wid = opts?.workerId ?? workerId;
  if (opts?.shuttingDown?.()) return;
  const slots = workerConcurrency();
  const claimLimit = Math.max(0, Math.min(limit, slots));
  if (claimLimit === 0) return;
  const jobs = await claimJobs(claimLimit, wid);
  if (opts?.shuttingDown?.()) {
    await releaseUnstartedJobs(jobs, wid);
    return;
  }
  await runClaimedJobs(jobs, wid, slots, () => Boolean(opts?.shuttingDown?.()));
}

async function runClaimedJobs(
  jobs: Array<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    correlationId: string | null;
    claimGeneration: number;
    attempts: number;
    maxAttempts: number;
  }>,
  wid: string,
  slots: number,
  shuttingDown: () => boolean,
): Promise<void> {
  const pending = [...jobs];
  const typeBusy = new Map<string, number>();
  const keyBusy = new Set<string>();
  let active = 0;

  await new Promise<void>((resolve, reject) => {
    const launch = () => {
      if (shuttingDown()) {
        const rest = pending.splice(0, pending.length);
        void releaseUnstartedJobs(rest, wid).finally(() => {
          if (active === 0) resolve();
        });
        if (active === 0) resolve();
        return;
      }
      for (let i = 0; i < pending.length && active < slots; ) {
        const job = pending[i]!;
        const key = jobConcurrencyKey(job);
        const tLimit = jobTypeConcurrencyLimit(job.type);
        const tBusy = typeBusy.get(job.type) ?? 0;
        if (key && keyBusy.has(key)) {
          jobPipelineMetricsHit("key");
          i += 1;
          continue;
        }
        if (tBusy >= tLimit) {
          jobPipelineMetricsHit("type");
          i += 1;
          continue;
        }
        pending.splice(i, 1);
        if (key) keyBusy.add(key);
        typeBusy.set(job.type, tBusy + 1);
        active += 1;
        pipelineSaturation(active, slots);
        void executeClaimedCrmJob(job, wid)
          .catch(reject)
          .finally(() => {
            active -= 1;
            if (key) keyBusy.delete(key);
            typeBusy.set(job.type, Math.max(0, (typeBusy.get(job.type) ?? 1) - 1));
            pipelineSaturation(active, slots);
            launch();
          });
      }
      if (pending.length === 0 && active === 0) resolve();
    };
    launch();
  });
}

function jobPipelineMetricsHit(kind: "type" | "key"): void {
  if (kind === "type") jobPipelineMetrics.typeLimitHits += 1;
  else jobPipelineMetrics.keyLimitHits += 1;
}

export async function executeClaimedCrmJob(
  job: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    correlationId: string | null;
    claimGeneration: number;
    attempts: number;
    maxAttempts: number;
    createdAt?: Date;
    lockedAt?: Date | null;
  },
  wid: string,
): Promise<void> {
  const soakRunId = typeof job.payload.soakRunId === "string" ? job.payload.soakRunId : undefined;
  const claimWaitMs =
    job.lockedAt && job.createdAt ? Math.max(0, job.lockedAt.getTime() - job.createdAt.getTime()) : undefined;
  const startedAt = Date.now();
  const heartbeatsBefore = queueMetrics.heartbeatsRenewed;
  recordJobPipelineEvent({
    ts: startedAt,
    event: "started",
    jobId: job.id,
    type: job.type,
    workerId: wid,
    claimGeneration: job.claimGeneration,
    attempts: job.attempts,
    claimWaitMs,
    soakRunId,
    correlationId: job.correlationId,
    concurrencyKey: jobConcurrencyKey(job),
  });
  try {
    await withJobHeartbeat(
      {
        jobId: job.id,
        workerId: wid,
        claimGeneration: job.claimGeneration,
      },
      async (signal) => {
        if (signal.aborted) throw new LostOwnershipError(job.id);
        const ctx: JobRunContext = {
          jobId: job.id,
          workerId: wid,
          claimGeneration: job.claimGeneration,
          attempts: job.attempts,
          signal,
        };
        await handleJob(job.type, job.payload as Record<string, unknown>, job.correlationId, ctx);
        if (signal.aborted) throw new LostOwnershipError(job.id);
      },
    );
    const processingMs = Date.now() - startedAt;
    const commitStarted = Date.now();
    const owned = await completeJob({
      jobId: job.id,
      workerId: wid,
      claimGeneration: job.claimGeneration,
    });
    const commitMs = Date.now() - commitStarted;
    if (!owned) {
      recordJobPipelineEvent({
        ts: Date.now(),
        event: "lost_ownership",
        jobId: job.id,
        type: job.type,
        workerId: wid,
        claimGeneration: job.claimGeneration,
        attempts: job.attempts,
        retryClass: "contention",
        expected: false,
        soakRunId,
        correlationId: job.correlationId,
      });
      return;
    }
    recordJobPipelineEvent({
      ts: Date.now(),
      event: "completed",
      jobId: job.id,
      type: job.type,
      workerId: wid,
      claimGeneration: job.claimGeneration,
      attempts: job.attempts,
      claimWaitMs,
      processingMs,
      commitMs,
      heartbeatCount: queueMetrics.heartbeatsRenewed - heartbeatsBefore,
      e2eMs: job.createdAt ? Date.now() - job.createdAt.getTime() : processingMs + (claimWaitMs ?? 0),
      soakRunId,
      correlationId: job.correlationId,
    });
    if (job.type === "refresh_sla") {
      await scheduleRecurringSlaRefresh();
    }
    if (job.type === "enforce_retention") {
      await scheduleRecurringRetention();
    }
    if (job.type === "marketing_publish_due") {
      await scheduleMarketingPublishDue();
    }
  } catch (err) {
    if (err instanceof LostOwnershipError) {
      logger.warn({ jobId: job.id }, "skipped complete/fail after lost ownership");
      recordJobPipelineEvent({
        ts: Date.now(),
        event: "lost_ownership",
        jobId: job.id,
        type: job.type,
        workerId: wid,
        claimGeneration: job.claimGeneration,
        attempts: job.attempts,
        retryClass: "contention",
        expected: false,
        soakRunId,
        correlationId: job.correlationId,
      });
      return;
    }
    if (err instanceof UnknownJobTypeError) {
      queueMetrics.unknownType += 1;
    }
    logger.error({ err, jobId: job.id, type: job.type }, "crm job failed");
    await failJob({
      jobId: job.id,
      workerId: wid,
      claimGeneration: job.claimGeneration,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      error: err instanceof Error ? err.message : "job failed",
      type: job.type,
      immediateDead: err instanceof UnknownJobTypeError,
    });
  }
}

async function runGraphDeltaSyncJob(): Promise<void> {
  const { loadMicrosoftGraphConfig } = await import("./microsoftGraph/config");
  const { runGraphDeltaSync } = await import("./microsoftGraph/inbound");
  const config = loadMicrosoftGraphConfig();
  if (!config) return;
  await runGraphDeltaSync(config);
}

async function runGraphSubscriptionRenewalJob(): Promise<void> {
  const { loadMicrosoftGraphConfig } = await import("./microsoftGraph/config");
  const { ensureGraphMailSubscription } = await import("./microsoftGraph/inbound");
  const config = loadMicrosoftGraphConfig();
  if (!config) return;
  await ensureGraphMailSubscription(config);
}

async function handleJob(
  type: string,
  payload: Record<string, unknown>,
  correlationId: string | null,
  ctx: JobRunContext,
): Promise<void> {
  if (type === "__test_sleep") {
    if (process.env.CRM_ALLOW_TEST_JOBS !== "true") throw new UnknownJobTypeError(type);
    const ms = Number(payload.ms ?? 400);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, Number.isFinite(ms) ? ms : 400);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new LostOwnershipError("test-sleep"));
      });
    });
    return;
  }
  if (type === "__test_ignore_cancel") {
    if (process.env.CRM_ALLOW_TEST_JOBS !== "true") throw new UnknownJobTypeError(type);
    const ms = Number(payload.ms ?? 800);
    await new Promise<void>((resolve) => setTimeout(resolve, Number.isFinite(ms) ? ms : 800));
    return;
  }
  if (type === "__test_fail_until") {
    if (process.env.CRM_ALLOW_TEST_JOBS !== "true") throw new UnknownJobTypeError(type);
    const need = Number(payload.succeedOnAttempt ?? 2);
    if ((ctx.attempts ?? 0) < need) throw new Error("injected transient soak failure");
    return;
  }
  await assertJobOwned(ctx);
  switch (type) {
    case "send_acknowledgment":
      await sendInquiryEmail(String(payload.inquiryId), String(payload.templateKey), undefined, ctx);
      break;
    case "notify_staff":
      await notifyStaff(payload, ctx);
      break;
    case "analytics":
      await insertAnalytics(payload, ctx);
      break;
    case "ai_classify":
      await runAiClassify(String(payload.inquiryId), ctx);
      break;
    case "run_workflows":
      await runWorkflows(String(payload.trigger), String(payload.inquiryId), correlationId, ctx);
      break;
    case "refresh_sla":
      await refreshSlaStatuses(ctx);
      break;
    case "enforce_retention":
      await (await import("./governance")).enforceInquiryRetention(undefined, ctx);
      break;
    case "graph_mail_delta_sync":
      await runGraphDeltaSyncJob();
      break;
    case "graph_mail_subscription_renewal":
      await runGraphSubscriptionRenewalJob();
      break;
    case "marketing_publish_due":
      await (await import("./marketingCommands")).publishDueScheduledVersions({ ctx });
      break;
    case "marketing_reconcile_publish":
      await (await import("./marketingPublishing")).reconcilePublish({
        versionId: String(payload.versionId),
        kind: (payload.kind as "cache" | "notify" | undefined) ?? "all",
      });
      break;
    case "crm_export":
      await (await import("./exportJobs")).processExportJob(String(payload.exportJobId));
      break;
    case "connector_outbound":
      await (await import("./connectors/outbound")).processConnectorOutbound(payload, ctx);
      break;
    default:
      throw new UnknownJobTypeError(type);
  }
}

async function insertAnalytics(payload: Record<string, unknown>, ctx: JobRunContext): Promise<void> {
  await assertJobOwned(ctx);
  await delayIfTestJob(ctx);
  await assertJobOwned(ctx);
  const key = `analytics:${ctx.jobId}:${String(payload.event)}`;
  await applyTransactionalDbEffect({
    key,
    kind: "analytics",
    payload: { event: payload.event, inquiryId: payload.inquiryId },
    ctx,
    work: async (tx) => {
      await tx.insert(crmAnalyticsEventsTable).values({
        event: String(payload.event),
        inquiryId: typeof payload.inquiryId === "string" ? payload.inquiryId : null,
        contactId: typeof payload.contactId === "string" ? payload.contactId : null,
        properties: (payload.properties as Record<string, unknown>) ?? {},
      });
    },
  });
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

export async function loadEmailThreadParent(inquiryId: string): Promise<ThreadParent | undefined> {
  const [parent] = await db
    .select({
      messageId: crmMessagesTable.messageId,
      referencesHeader: crmMessagesTable.referencesHeader,
      externalMessageId: crmMessagesTable.externalMessageId,
    })
    .from(crmMessagesTable)
    .where(
      and(eq(crmMessagesTable.inquiryId, inquiryId), eq(crmMessagesTable.channel, "email")),
    )
    .orderBy(desc(crmMessagesTable.createdAt))
    .limit(1);
  const messageId = parent?.messageId ?? parent?.externalMessageId ?? null;
  if (!messageId) return undefined;
  return { messageId, referencesHeader: parent?.referencesHeader ?? null };
}

export async function sendInquiryEmail(
  inquiryId: string,
  templateKey: string,
  extra?: { body?: string; kind?: string; logicalIntentId?: string },
  run?: JobRunContext,
): Promise<{ messageId: string } | null> {
  if (run) {
    await assertJobOwned(run);
    await delayIfTestJob(run);
    await assertJobOwned(run);
  }
  const intent = extra?.body ? "custom-body" : extra?.kind ?? "template";
  const logicalIntentId = extra?.logicalIntentId ?? run?.jobId ?? randomUUID();
  const failAt = process.env.CRM_TEST_EFFECT_FAIL_AT;
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
  const effectKey = emailEffectKey({
    inquiryId,
    templateKey,
    intent,
    logicalIntentId,
  });
  if (run) {
    await insertPendingEffect({
      key: effectKey,
      kind: "email",
      payload: { inquiryId, templateKey, intent, logicalIntentId },
      ctx: run,
      providerIdempotencyKey: effectKey,
    });
    if (failAt === "after_pending") throw new Error("injected failure after email reservation");
  }
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
  const html = `<div style="font-family:Inter,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b1220">${textToHtml(body)}</div>`;
  const threading = buildThreadingHeaders(await loadEmailThreadParent(inquiryId), extractMailDomain());
  const recipientHash = createHash("sha256").update(ctx.contact.email).digest("hex");
  const contentHash = createHash("sha256").update(`${subject}\n${body}`).digest("hex");
  await db
    .insert(crmOutboundSendsTable)
    .values({
      logicalIntentId,
      effectKey,
      inquiryId,
      templateKey,
      templateVersionId: version.id,
      providerIdempotencyKey: effectKey,
      recipientHash,
      contentHash,
      status: "pending",
    })
    .onConflictDoNothing();
  if (run) await assertJobOwned(run);

  let lease: EffectLease | null = null;
  if (run) {
    lease = await db.transaction(async (tx) =>
      claimEffectForWork(tx, {
        key: effectKey,
        kind: "email",
        payload: { inquiryId, templateKey, intent, logicalIntentId },
        ctx: run,
        providerIdempotencyKey: effectKey,
      }),
    );
    if (!lease) return null;
    if (failAt === "after_executing") throw new Error("injected failure after email executing claim");
    const started = await db.transaction(async (tx) =>
      transitionEffect(tx, lease!, ["executing"], { status: "provider_request_started" }),
    );
    if (!started) throw new LostOwnershipError(run.jobId);
    await db
      .update(crmOutboundSendsTable)
      .set({ status: "provider_request_started", startedAt: new Date(), attempts: sql`${crmOutboundSendsTable.attempts} + 1` })
      .where(eq(crmOutboundSendsTable.logicalIntentId, logicalIntentId));
  }

  let providerMessageId: string | null = null;
  let providerRequestId: string | null = null;
  try {
    if (failAt === "before_send") throw new Error("injected failure before provider send");
    if (process.env.CRM_EMAIL_SIMULATOR === "true" || process.env.CRM_ALLOW_TEST_JOBS === "true") {
      const sim = await simulatedProviderSend({
        idempotencyKey: effectKey,
        to: ctx.contact.email,
        subject,
      });
      providerMessageId = sim.providerMessageId;
      providerRequestId = sim.providerRequestId;
    } else {
      providerMessageId = await sendTransactionalEmail(
        {
          to: ctx.contact.email,
          subject,
          text: body,
          html,
          headers: {
            messageId: threading.messageId,
            inReplyTo: threading.inReplyTo,
            references: threading.references,
          },
        },
        { idempotencyKey: effectKey },
      );
    }
    if (lease) {
      const accepted = await db.transaction(async (tx) =>
        transitionEffect(tx, lease!, ["provider_request_started", "executing"], {
          status: "accepted",
          providerMessageId,
          providerRequestId,
        }),
      );
      if (!accepted) throw new LostOwnershipError(run!.jobId);
      await db
        .update(crmOutboundSendsTable)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          providerMessageId,
          providerRequestId,
        })
        .where(eq(crmOutboundSendsTable.logicalIntentId, logicalIntentId));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const unknown = /timeout after acceptance|timeout before|ECONNRESET|unknown/i.test(msg);
    if (lease) {
      if (unknown || failAt === "after_provider") {
        await failEffect(lease, msg, { uncertain: true });
      } else {
        await failEffect(lease, msg);
      }
    }
    if (failAt === "after_provider") throw new Error("injected failure after provider acceptance");
    throw err;
  }
  if (failAt === "after_provider") {
    if (lease) await failEffect(lease, "injected after provider", { uncertain: true });
    throw new Error("injected failure after provider acceptance");
  }

  return db.transaction(async (tx) => {
    if (run && !(await stillOwnsJob({ ...run, executor: tx }))) {
      throw new LostOwnershipError(run.jobId);
    }
    const [msg] = await tx
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
        textBody: body,
        sanitizedHtml: html,
        templateId: template.id,
        templateVersionId: version.id,
        messageId: threading.messageId,
        inReplyTo: threading.inReplyTo ?? null,
        referencesHeader: threading.references ?? null,
        providerMessageId,
        externalMessageId: threading.messageId,
        deliveryStatus: providerMessageId ? "accepted" : "skipped",
      })
      .returning({ id: crmMessagesTable.id });
    if (failAt === "after_message") throw new Error("injected failure after message insert");
    if (lease) {
      await commitEffect(tx, lease, run, { providerMessageId, providerRequestId });
      await tx
        .update(crmOutboundSendsTable)
        .set({ status: "locally_committed", committedAt: new Date(), crmMessageId: msg.id })
        .where(eq(crmOutboundSendsTable.logicalIntentId, logicalIntentId));
    }
    return { messageId: msg.id };
  });
}

async function notifyStaff(payload: Record<string, unknown>, run?: JobRunContext): Promise<void> {
  if (run) {
    await assertJobOwned(run);
    await delayIfTestJob(run);
    await assertJobOwned(run);
  }
  const staffId = String(payload.staffId ?? "");
  if (!staffId) return;
  let inquiryId =
    typeof payload.inquiryId === "string" && payload.inquiryId.length > 0 ? payload.inquiryId : null;
  if (inquiryId) {
    const [exists] = await db
      .select({ id: crmInquiriesTable.id })
      .from(crmInquiriesTable)
      .where(eq(crmInquiriesTable.id, inquiryId))
      .limit(1);
    if (!exists) inquiryId = null;
  }
  const key = `notify:${staffId}:${inquiryId ?? ""}:${String(payload.type ?? "notice")}:${run?.jobId ?? "adhoc"}`;
  await applyTransactionalDbEffect({
    key,
    kind: "notification",
    payload: { staffId, type: payload.type, inquiryId },
    ctx: run,
    work: async (tx) => {
      await tx.insert(crmNotificationsTable).values({
        staffId,
        inquiryId,
        type: String(payload.type ?? "notice"),
        title: String(payload.title ?? "Notification"),
        body: typeof payload.body === "string" ? payload.body : null,
      });
    },
  });
}

async function runAiClassify(inquiryId: string, run?: JobRunContext): Promise<void> {
  if (run) await assertJobOwned(run);
  const key = `ai:${inquiryId}:${run?.jobId ?? "adhoc"}`;
  await applyTransactionalDbEffect({
    key,
    kind: "ai",
    payload: { inquiryId },
    ctx: run,
    work: async (tx) => {
      const [msg] = await tx
        .select()
        .from(crmMessagesTable)
        .where(and(eq(crmMessagesTable.inquiryId, inquiryId), eq(crmMessagesTable.kind, "web_form")))
        .limit(1);
      const output = heuristicClassify(msg?.body ?? "");
      await tx.insert(crmAiClassificationsTable).values({
        inquiryId,
        provider: "heuristic",
        model: "keyword-v1",
        confidence: output.confidence,
        output: output as unknown as Record<string, unknown>,
      });
      await writeAudit(
        {
          actorType: "system",
          action: "ai.classified",
          entityType: "inquiry",
          entityId: inquiryId,
          inquiryId,
          afterValue: output as unknown as Record<string, unknown>,
        },
        tx,
      );
    },
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
  if (existing) {
    const reused = parseGovernedBookingUrl(existing.bookingUrl);
    if (!reused) return null;
    for (const key of [...reused.searchParams.keys()]) {
      if (/^(email|name|first_name|last_name|full_name|phone)$/i.test(key)) {
        reused.searchParams.delete(key);
      }
    }
    return reused.toString();
  }
  const [type] = await db
    .select()
    .from(crmMeetingTypesTable)
    .where(eq(crmMeetingTypesTable.status, "active"))
    .limit(1);
  if (!type) return null;
  const url = parseGovernedBookingUrl(type.bookingUrl);
  if (!url) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (/^(email|name|first_name|last_name|full_name|phone)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.set("a1", ctx.inquiry.reference);
  if (type.timezone) url.searchParams.set("tz", type.timezone);
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
    afterValue: { bookingUrl: bookingUrlForAudit(url), meetingTypeId: type.id, timezone: type.timezone },
  });
  return bookingUrl;
}

async function runWorkflows(
  trigger: string,
  inquiryId: string,
  correlationId: string | null,
  run?: JobRunContext,
): Promise<void> {
  if (run) await assertJobOwned(run);
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
        if (run) {
          await assertJobOwned(run);
          await delayIfTestJob(run);
          await assertJobOwned(run);
        }
        const actionKey = `wf:${exec.id}:${action.type}:${String(action.params?.key ?? action.params?.slug ?? "")}`;
        if (action.type === "send_template") {
          await sendInquiryEmail(inquiryId, String(action.params?.key), undefined, run);
          continue;
        }
        await applyTransactionalDbEffect({
          key: actionKey,
          kind: "workflow_action",
          payload: { type: action.type, params: action.params, executionId: exec.id },
          ctx: run,
          work: async (tx) => {
            await applyAction(inquiryId, action, wf.id, correlationId, run, tx);
          },
        });
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
  run?: JobRunContext,
  executor: DbSession = db,
): Promise<void> {
  const params = action.params ?? {};
  switch (action.type) {
    case "send_template":
      await sendInquiryEmail(inquiryId, String(params.key), undefined, run);
      break;
    case "set_priority":
      await executor
        .update(crmInquiriesTable)
        .set({ priority: String(params.priority), updatedAt: new Date() })
        .where(eq(crmInquiriesTable.id, inquiryId));
      break;
    case "change_status":
      await executor
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
        }, run);
      }
      break;
    }
    default:
      logger.warn({ action: action.type, workflowId, correlationId }, "unknown workflow action");
  }
}

async function refreshSlaStatuses(run?: JobRunContext): Promise<void> {
  if (run) {
    await assertJobOwned(run);
    await delayIfTestJob(run);
    await assertJobOwned(run);
  }
  const now = new Date();
  const open = await db
    .select()
    .from(crmSlaInstancesTable)
    .where(inArray(crmSlaInstancesTable.status, ["ON_TRACK", "AT_RISK", "OPEN"]));
  for (const row of open) {
    const status = evaluateClock(row.dueAt, now);
    if (status !== row.status) {
      if (run) {
        await assertJobOwned(run);
        await delayIfTestJob(run);
        await assertJobOwned(run);
      }
      const key = `sla:${row.id}:${status}`;
      await applyTransactionalDbEffect({
        key,
        kind: "sla",
        payload: { slaId: row.id, status },
        ctx: run,
        work: async (tx) => {
          await tx
            .update(crmSlaInstancesTable)
            .set({ status })
            .where(eq(crmSlaInstancesTable.id, row.id));
          if (status === "BREACHED") {
            await tx.insert(crmAnalyticsEventsTable).values({
              event: "sla_breached",
              inquiryId: row.inquiryId,
              properties: { measure: row.measure, policyVersion: row.policyVersion },
            });
          }
        },
      });
      if (status === "BREACHED") {
        const escalation = escalationForClock({
          previousStatus: row.status,
          nextStatus: status,
          measure: row.measure,
        });
        if (escalation) {
          const [inq] = await db
            .select({ assignedStaffId: crmInquiriesTable.assignedStaffId, reference: crmInquiriesTable.reference })
            .from(crmInquiriesTable)
            .where(eq(crmInquiriesTable.id, row.inquiryId))
            .limit(1);
          if (inq?.assignedStaffId) {
            await notifyStaff({
              staffId: inq.assignedStaffId,
              inquiryId: row.inquiryId,
              type: "sla_escalation",
              title: `SLA breached: ${row.measure}`,
              body: inq.reference,
            }, run);
          }
        }
      }
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;
let inFlightCount = 0;
let signalBound = false;

function onWorkerSignal() {
  void shutdownCrmJobWorker().then((code) => {
    if (process.env.CRM_WORKER_EXIT_ON_SHUTDOWN === "true") {
      process.exit(code);
    }
  });
}

/**
 * Dedicated CRM worker loop. Must not be started inside the web process in production.
 * Shutdown: stop claims; release unstarted; drain until CRM_WORKER_SHUTDOWN_MS;
 * then abort in-flight handlers. Exit code 0 drained, 1 deadline with remaining work.
 */
export function startCrmJobWorker(opts?: { bindSignals?: boolean }): void {
  shuttingDown = false;
  if (timer) return;
  const intervalMs = Number(process.env.CRM_WORKER_POLL_MS ?? 2000);
  const claimMax = Number(process.env.CRM_WORKER_CLAIM_MAX ?? workerConcurrency());
  const tick = () => {
    if (shuttingDown || inFlightCount > 0) return;
    inFlightCount += 1;
    processCrmJobs(Number.isFinite(claimMax) && claimMax > 0 ? claimMax : workerConcurrency(), { workerId, shuttingDown: () => shuttingDown })
      .then(() => import("./inboundEmail").then((m) => m.reclaimStaleWebhookReceipts()))
      .then(() => import("./inboundEmail").then((m) => m.processDueStoredReceipts()))
      .then(() => import("./effects").then((m) => m.processRecoverableEffects()))
      .catch((err) => logger.error({ err }, "crm job worker tick failed"))
      .finally(() => {
        inFlightCount = Math.max(0, inFlightCount - 1);
      });
  };
  timer = setInterval(tick, Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 2000);
  tick();
  void scheduleRecurringSlaRefresh().catch((err) =>
    logger.error({ err }, "failed to schedule SLA refresh"),
  );
  void scheduleRecurringRetention().catch((err) =>
    logger.error({ err }, "failed to schedule retention"),
  );
  void scheduleGraphMailMaintenance().catch((err) =>
    logger.error({ err }, "failed to schedule Graph mail maintenance"),
  );
  void scheduleMarketingPublishDue().catch((err) =>
    logger.error({ err }, "failed to schedule marketing publish due"),
  );
  if (opts?.bindSignals !== false && !signalBound) {
    process.on("SIGTERM", onWorkerSignal);
    process.on("SIGINT", onWorkerSignal);
    signalBound = true;
  }
}

export async function shutdownCrmJobWorker(deadlineMs?: number): Promise<number> {
  shuttingDown = true;
  if (timer) clearInterval(timer);
  timer = null;
  logger.info({ workerId }, "crm job worker shutting down");
  const limit = deadlineMs ?? Number(process.env.CRM_WORKER_SHUTDOWN_MS ?? 15_000);
  const started = Date.now();
  const max = Number.isFinite(limit) && limit > 0 ? limit : 15_000;
  while (inFlightCount > 0 && Date.now() - started < max) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (inFlightCount > 0) {
    queueMetrics.shutdownForced += 1;
    logger.error({ workerId, inFlightCount }, "shutdown deadline; aborting in-flight handlers");
    for (const ctl of activeHandlerAborts) ctl.abort();
    const grace = Date.now() + 2_000;
    while (inFlightCount > 0 && Date.now() < grace) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (signalBound) {
    process.removeListener("SIGTERM", onWorkerSignal);
    process.removeListener("SIGINT", onWorkerSignal);
    signalBound = false;
  }
  if (inFlightCount > 0) {
    logger.error({ workerId, inFlightCount }, "handlers still running after abort; process should exit 1");
    return 1;
  }
  logger.info({ workerId }, "crm job worker shutdown complete");
  return 0;
}
