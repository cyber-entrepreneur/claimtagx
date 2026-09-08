import { createHash, randomUUID } from "node:crypto";
import {
  db,
  crmConversationsTable,
  crmEmailQuarantineTable,
  crmInquiriesTable,
  crmMessagesTable,
  crmWebhookReceiptsTable,
  type DbSession,
} from "@workspace/db";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import { enqueueJob } from "./queue";
import { sanitizeHtml } from "./htmlSanitize";
import { associateToConversation, parseInboundHeaders } from "./emailThreading";
import { onCustomerReply } from "./slaLifecycle";

export function payloadHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export type InboundEmailPayload = {
  from: string;
  subject?: string;
  text: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
};

export const webhookInboxMetrics = {
  hashMismatch: 0,
  reaped: 0,
  failedAfterSuccessIgnored: 0,
  internalRetries: 0,
  missingPayload: 0,
};

async function lockEvent(tx: DbSession, providerEventId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"crm.webhook." + providerEventId}))`);
}

const RECEIPT_LEASE_MS = 30_000;
const MAX_WEBHOOK_ATTEMPTS = 8;

function leaseActive(row: { leaseExpiresAt?: Date | null; status: string }): boolean {
  return row.status === "processing" && Boolean(row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now());
}

async function failReceiptIfOwned(providerEventId: string, token: string | null, error: string) {
  await db.transaction(async (tx) => {
    await lockEvent(tx, providerEventId);
    const [current] = await tx
      .select()
      .from(crmWebhookReceiptsTable)
      .where(eq(crmWebhookReceiptsTable.providerEventId, providerEventId))
      .limit(1);
    if (!current || current.status !== "processing") {
      webhookInboxMetrics.failedAfterSuccessIgnored += 1;
      return;
    }
    const terminal = current.attempts >= MAX_WEBHOOK_ATTEMPTS;
    const result = await tx
      .update(crmWebhookReceiptsTable)
      .set({
        status: terminal ? "terminal_failed" : "retryable_failed",
        lastError: error.slice(0, 2000),
        updatedAt: new Date(),
        nextAttemptAt: terminal ? null : new Date(Date.now() + (current.attempts >= 3 ? 15_000 : 0)),
        processingToken: null,
        processingOwner: null,
        leaseExpiresAt: null,
        terminal,
      })
      .where(
        and(
          eq(crmWebhookReceiptsTable.providerEventId, providerEventId),
          eq(crmWebhookReceiptsTable.status, "processing"),
          token ? eq(crmWebhookReceiptsTable.processingToken, token) : sql`true`,
        ),
      )
      .returning({ id: crmWebhookReceiptsTable.providerEventId });
    if (result.length === 0) webhookInboxMetrics.failedAfterSuccessIgnored += 1;
  });
}

export async function reclaimStaleWebhookReceipts(): Promise<number> {
  const rows = await db
    .update(crmWebhookReceiptsTable)
    .set({
      status: "retryable_failed",
      lastError: "processing lease expired",
      processingToken: null,
      processingOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(crmWebhookReceiptsTable.status, "processing"),
        sql`${crmWebhookReceiptsTable.leaseExpiresAt} < now()`,
        eq(crmWebhookReceiptsTable.terminal, false),
      ),
    )
    .returning({ id: crmWebhookReceiptsTable.providerEventId });
  webhookInboxMetrics.reaped += rows.length;
  return rows.length;
}

export async function processDueStoredReceipts(limit = 20): Promise<number> {
  const due = await db
    .select()
    .from(crmWebhookReceiptsTable)
    .where(
      and(
        inArray(crmWebhookReceiptsTable.status, ["received", "retryable_failed"]),
        eq(crmWebhookReceiptsTable.terminal, false),
        sql`(${crmWebhookReceiptsTable.nextAttemptAt} IS NULL OR ${crmWebhookReceiptsTable.nextAttemptAt} <= now())`,
      ),
    )
    .limit(limit);
  let n = 0;
  for (const row of due) {
    if (!row.rawPayload) {
      webhookInboxMetrics.missingPayload += 1;
      await db
        .update(crmWebhookReceiptsTable)
        .set({
          status: "terminal_failed",
          terminal: true,
          lastError: "missing stored payload",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(crmWebhookReceiptsTable.providerEventId, row.providerEventId),
            inArray(crmWebhookReceiptsTable.status, ["received", "retryable_failed"]),
          ),
        );
      continue;
    }
    const payload = (row.normalizedPayload ?? {}) as InboundEmailPayload;
    webhookInboxMetrics.internalRetries += 1;
    await processInboundEmail({
      providerEventId: row.providerEventId,
      rawBody: row.rawPayload,
      payload: {
        from: payload.from ?? "unknown@invalid",
        subject: payload.subject,
        text: payload.text ?? "",
        html: payload.html,
        messageId: payload.messageId,
        inReplyTo: payload.inReplyTo,
        references: payload.references,
      },
      headers: {},
    });
    n += 1;
  }
  return n;
}

export async function purgeExpiredWebhookPayloads(): Promise<number> {
  const rows = await db
    .update(crmWebhookReceiptsTable)
    .set({ rawPayload: null, normalizedPayload: null, updatedAt: new Date() })
    .where(and(sql`${crmWebhookReceiptsTable.retainedUntil} < now()`, sql`${crmWebhookReceiptsTable.rawPayload} IS NOT NULL`))
    .returning({ id: crmWebhookReceiptsTable.providerEventId });
  return rows.length;
}

export async function processInboundEmail(input: {
  providerEventId: string;
  rawBody: string;
  payload: InboundEmailPayload;
  headers: Record<string, string | string[] | undefined>;
  failAfter?: "receipt" | "message" | "sla";
}): Promise<{ matched: boolean; duplicate?: boolean; quarantined?: boolean; reference?: string; status: string }> {
  const hash = payloadHash(input.rawBody);
  let processingToken: string | null = null;
  let hashIncident: { expected: string; actual: string } | null = null;

  let claimed: { duplicate: boolean; status: string };
  try {
    claimed = await db.transaction(async (tx) => {
    await lockEvent(tx, input.providerEventId);
    const [existing] = await tx
      .select()
      .from(crmWebhookReceiptsTable)
      .where(eq(crmWebhookReceiptsTable.providerEventId, input.providerEventId))
      .limit(1);
    if (existing) {
      if (existing.payloadHash && existing.payloadHash !== hash) {
        webhookInboxMetrics.hashMismatch += 1;
        hashIncident = { expected: existing.payloadHash, actual: hash };
        throw Object.assign(new Error("Webhook event id reused with a different payload"), { status: 409 });
      }
      if (existing.status === "processed" || existing.status === "quarantined" || existing.status === "terminal_failed") {
        return { duplicate: true as const, status: existing.status };
      }
      if (leaseActive(existing)) {
        return { duplicate: true as const, status: existing.status };
      }
      if (existing.attempts >= MAX_WEBHOOK_ATTEMPTS) {
        await tx
          .update(crmWebhookReceiptsTable)
          .set({ terminal: true, status: "terminal_failed", lastError: "retry exhausted", updatedAt: new Date() })
          .where(eq(crmWebhookReceiptsTable.providerEventId, input.providerEventId));
        return { duplicate: true as const, status: "terminal_failed" as const };
      }
      processingToken = randomUUID();
      await tx
        .update(crmWebhookReceiptsTable)
        .set({
          status: "processing",
          attempts: existing.attempts + 1,
          payloadHash: hash,
          rawPayload: existing.rawPayload ?? input.rawBody,
          normalizedPayload: (existing.normalizedPayload as InboundEmailPayload) ?? input.payload,
          lastError: input.failAfter === "receipt" ? "simulated failure after receipt" : existing.lastError,
          updatedAt: new Date(),
          claimGeneration: existing.claimGeneration + 1,
          processingToken,
          processingOwner: "inbound",
          leaseExpiresAt: new Date(Date.now() + RECEIPT_LEASE_MS),
        })
        .where(
          and(
            eq(crmWebhookReceiptsTable.providerEventId, input.providerEventId),
            eq(crmWebhookReceiptsTable.status, existing.status),
          ),
        );
      return { duplicate: false as const, status: "processing" as const };
    }
    processingToken = randomUUID();
    await tx.insert(crmWebhookReceiptsTable).values({
      providerEventId: input.providerEventId,
      payloadHash: hash,
      status: "received",
      attempts: 0,
      lastError: null,
      claimGeneration: 0,
      rawPayload: input.rawBody,
      normalizedPayload: input.payload,
      payloadEncrypted: false,
      retainedUntil: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    });
    await tx
      .update(crmWebhookReceiptsTable)
      .set({
        status: "processing",
        attempts: 1,
        claimGeneration: 1,
        processingToken,
        processingOwner: "inbound",
        leaseExpiresAt: new Date(Date.now() + RECEIPT_LEASE_MS),
        updatedAt: new Date(),
      })
      .where(eq(crmWebhookReceiptsTable.providerEventId, input.providerEventId));
    return { duplicate: false as const, status: "processing" as const };
    });
  } catch (err) {
    if (hashIncident) {
      await writeAudit({
        actorType: "system",
        action: "security.webhook.hash_mismatch",
        entityType: "webhook_receipt",
        entityId: input.providerEventId,
        afterValue: hashIncident,
      });
    }
    throw err;
  }

  if (claimed.duplicate) {
    return { matched: true, duplicate: true, status: claimed.status };
  }

  try {
    if (input.failAfter === "receipt") {
      throw Object.assign(new Error("simulated failure after receipt"), { status: 500 });
    }
    return await db.transaction(async (tx) => {
      await lockEvent(tx, input.providerEventId);
      const [receipt] = await tx
        .select()
        .from(crmWebhookReceiptsTable)
        .where(eq(crmWebhookReceiptsTable.providerEventId, input.providerEventId))
        .limit(1);
      if (receipt && (receipt.status === "processed" || receipt.status === "quarantined")) {
        return { matched: true, duplicate: true, status: receipt.status };
      }
      if (receipt?.payloadHash && receipt.payloadHash !== hash) {
        throw Object.assign(new Error("Webhook event id reused with a different payload"), { status: 409 });
      }

      const parsed = parseInboundHeaders({
        messageId: input.payload.messageId,
        inReplyTo: input.payload.inReplyTo,
        references: input.payload.references,
        headers: input.headers,
      });
      const association = associateToConversation({
        subject: input.payload.subject,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
      });
      let inquiry = association.reference
        ? (
            await tx
              .select()
              .from(crmInquiriesTable)
              .where(eq(crmInquiriesTable.reference, association.reference))
              .limit(1)
          )[0]
        : undefined;
      if (!inquiry && association.parentMessageId) {
        const [parentMsg] = await tx
          .select({ inquiryId: crmMessagesTable.inquiryId })
          .from(crmMessagesTable)
          .where(
            or(
              eq(crmMessagesTable.messageId, association.parentMessageId),
              eq(crmMessagesTable.externalMessageId, association.parentMessageId),
            ),
          )
          .limit(1);
        if (parentMsg) {
          inquiry = (
            await tx.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.id, parentMsg.inquiryId)).limit(1)
          )[0];
        }
      }

      const mark = async (status: "processed" | "quarantined") => {
        const updated = await tx
          .update(crmWebhookReceiptsTable)
          .set({
            status,
            lastError: null,
            processedAt: new Date(),
            updatedAt: new Date(),
            terminal: true,
            processingToken: null,
            processingOwner: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(crmWebhookReceiptsTable.providerEventId, input.providerEventId),
              eq(crmWebhookReceiptsTable.status, "processing"),
              processingToken
                ? eq(crmWebhookReceiptsTable.processingToken, processingToken)
                : sql`true`,
            ),
          )
          .returning({ id: crmWebhookReceiptsTable.providerEventId });
        if (updated.length === 0) {
          throw Object.assign(new Error("lost webhook receipt ownership"), { status: 409 });
        }
      };

      if (!inquiry) {
        await tx.insert(crmEmailQuarantineTable).values({
          reason: "unknown_thread",
          subject: input.payload.subject ?? null,
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          payload: { providerEventId: input.providerEventId },
          status: "open",
        });
        await mark("quarantined");
        return { matched: false, quarantined: true, status: "quarantined" as const };
      }

      const [conversation] = await tx
        .select()
        .from(crmConversationsTable)
        .where(eq(crmConversationsTable.inquiryId, inquiry.id))
        .limit(1);
      if (!conversation) {
        await tx.insert(crmEmailQuarantineTable).values({
          reason: "unknown_thread",
          subject: input.payload.subject ?? null,
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          payload: { inquiryId: inquiry.id, missingConversation: true },
          status: "open",
        });
        await mark("quarantined");
        return { matched: false, quarantined: true, status: "quarantined" as const };
      }

      try {
        await tx.insert(crmMessagesTable).values({
          conversationId: conversation.id,
          inquiryId: inquiry.id,
          kind: "customer_email_reply",
          visibility: "customer",
          channel: "email",
          authorType: "contact",
          authorContactId: inquiry.contactId,
          subject: input.payload.subject ?? null,
          body: input.payload.text,
          bodyHtml: input.payload.html ?? null,
          textBody: input.payload.text,
          sanitizedHtml: input.payload.html ? sanitizeHtml(input.payload.html) : null,
          messageId: parsed.messageId,
          externalMessageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          referencesHeader: parsed.referencesHeader,
          providerEventId: input.providerEventId,
          deliveryStatus: "received",
        });
      } catch (err) {
        const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
        if (code === "23505") {
          await mark("processed");
          return { matched: true, duplicate: true, reference: inquiry.reference, status: "processed" as const };
        }
        throw err;
      }
      if (input.failAfter === "message") {
        throw Object.assign(new Error("simulated failure after message"), { status: 500 });
      }

      await tx
        .update(crmInquiriesTable)
        .set({
          lastActivityAt: new Date(),
          lastCustomerMessageAt: new Date(),
          status: inquiry.status === "WAITING_FOR_CUSTOMER" ? "IN_PROGRESS" : inquiry.status,
          updatedAt: new Date(),
        })
        .where(eq(crmInquiriesTable.id, inquiry.id));
      if (input.failAfter === "sla") {
        throw Object.assign(new Error("simulated failure while applying SLA"), { status: 500 });
      }
      await onCustomerReply(inquiry.id, new Date(), tx);
      await writeAudit(
        {
          actorType: "contact",
          actorId: inquiry.contactId,
          action: "message.received",
          entityType: "inquiry",
          entityId: inquiry.id,
          inquiryId: inquiry.id,
        },
        tx,
      );
      if (inquiry.assignedStaffId) {
        await enqueueJob(
          "notify_staff",
          {
            staffId: inquiry.assignedStaffId,
            inquiryId: inquiry.id,
            type: "customer_reply",
            title: "Customer replied",
            body: inquiry.reference,
          },
          { executor: tx },
        );
      }
      await mark("processed");
      return { matched: true, reference: inquiry.reference, status: "processed" as const };
    });
  } catch (err) {
    await failReceiptIfOwned(
      input.providerEventId,
      processingToken,
      err instanceof Error ? err.message : "failed",
    );
    throw err;
  }
}

export async function replayWebhookReceipt(params: {
  providerEventId: string;
  actorStaffId: string;
}): Promise<{ ok: boolean; status: string }> {
  return db.transaction(async (tx) => {
    await lockEvent(tx, params.providerEventId);
    const [row] = await tx
      .select()
      .from(crmWebhookReceiptsTable)
      .where(eq(crmWebhookReceiptsTable.providerEventId, params.providerEventId))
      .limit(1);
    if (!row) throw Object.assign(new Error("Receipt not found"), { status: 404 });
    if (row.status === "processed" || row.status === "quarantined") {
      throw Object.assign(new Error("Successful receipts cannot be replayed"), { status: 409 });
    }
    const updated = await tx
      .update(crmWebhookReceiptsTable)
      .set({
        terminal: false,
        status: "retryable_failed",
        nextAttemptAt: new Date(),
        processingToken: null,
        processingOwner: null,
        leaseExpiresAt: null,
        lastError: "manual replay authorized",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(crmWebhookReceiptsTable.providerEventId, params.providerEventId),
          inArray(crmWebhookReceiptsTable.status, ["terminal_failed", "retryable_failed", "uncertain"]),
        ),
      )
      .returning();
    if (updated.length === 0) {
      throw Object.assign(new Error("Receipt is not in a terminal failed state"), { status: 409 });
    }
    await writeAudit(
      {
        actorType: "staff",
        actorId: params.actorStaffId,
        action: "webhook.replay",
        entityType: "webhook_receipt",
        entityId: params.providerEventId,
        afterValue: { previousAttempts: row.attempts },
      },
      tx,
    );
    return { ok: true, status: "failed" };
  });
}
