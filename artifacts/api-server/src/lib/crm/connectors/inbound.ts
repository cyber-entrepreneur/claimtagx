import { createHash, randomUUID } from "node:crypto";
import {
  db,
  crmChannelAccountsTable,
  crmChannelIdentitiesTable,
  crmConversationsTable,
  crmEmailQuarantineTable,
  crmInquiriesTable,
  crmInquiryCountersTable,
  crmMessagesTable,
  crmPendingDeliveriesTable,
  crmWebhookReceiptsTable,
  type DbSession,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { writeAudit } from "../audit";
import { enqueueJob } from "../queue";
import { sanitizeHtml } from "../htmlSanitize";
import { onCustomerReply } from "../slaLifecycle";
import { resolveChannelIdentity } from "./identity";
import { connectorMetrics } from "./metrics";
import { getChannelAdapter } from "./registry";
import { recordChannelActivity } from "./statusEvidence";
import type { CanonicalInboundMessage, ChannelAdapter, InboxChannel, ParsedInboundEvent } from "./types";

async function nextReference(ex: DbSession): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [row] = await ex
    .insert(crmInquiryCountersTable)
    .values({ year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: crmInquiryCountersTable.year,
      set: { lastNumber: sql`${crmInquiryCountersTable.lastNumber} + 1` },
    })
    .returning();
  return `CTX-${year}-${String(row?.lastNumber ?? 1).padStart(6, "0")}`;
}

export async function ingestConnectorEvents(params: {
  adapter: ChannelAdapter;
  rawBody: string;
  body: unknown;
  correlationId?: string;
}): Promise<{ accepted: number; duplicates: number; quarantined: number }> {
  const events = params.adapter.parseInboundEvents(params.body);
  let accepted = 0;
  let duplicates = 0;
  let quarantined = 0;
  if (events.length === 0) {
    connectorMetrics.inboundQuarantined += 1;
    await quarantine("unparsed_payload", params.rawBody, params.adapter.channel);
    const hash = createHash("sha256").update(params.rawBody).digest("hex");
    await db.insert(crmWebhookReceiptsTable).values({
      providerEventId: `quarantine:${params.adapter.channel}:${hash.slice(0, 32)}`,
      payloadHash: hash,
      status: "quarantined",
      attempts: 1,
      rawPayload: params.rawBody.slice(0, 50_000),
      normalizedPayload: { channel: params.adapter.channel, kind: "unparsed" },
      retainedUntil: new Date(Date.now() + 14 * 24 * 60 * 60_000),
      processingToken: randomUUID(),
      processingOwner: "connector",
      leaseExpiresAt: new Date(),
      terminal: true,
    }).onConflictDoNothing();
    return { accepted: 0, duplicates: 0, quarantined: 1 };
  }
  for (const event of events) {
    const result = await ingestOneEvent({
      adapter: params.adapter,
      event,
      rawBody: params.rawBody,
      correlationId: params.correlationId,
    });
    if (result === "duplicate") duplicates += 1;
    else if (result === "quarantined") quarantined += 1;
    else accepted += 1;
  }
  return { accepted, duplicates, quarantined };
}

async function quarantine(reason: string, raw: string, channel: string) {
  await db.insert(crmEmailQuarantineTable).values({
    status: "open",
    reason,
    payload: { channel, raw: raw.slice(0, 4000) },
  });
}

async function ingestOneEvent(params: {
  adapter: ChannelAdapter;
  event: ParsedInboundEvent;
  rawBody: string;
  correlationId?: string;
}): Promise<"ok" | "duplicate" | "quarantined"> {
  const hash = createHash("sha256").update(params.rawBody).digest("hex");
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"crm.webhook." + params.event.providerEventId}))`);
    const [existing] = await tx
      .select()
      .from(crmWebhookReceiptsTable)
      .where(eq(crmWebhookReceiptsTable.providerEventId, params.event.providerEventId))
      .limit(1);
    if (existing?.status === "processed" || existing?.status === "quarantined") {
      connectorMetrics.webhookDeduplicated += 1;
      return "duplicate" as const;
    }
    if (!existing) {
      await tx.insert(crmWebhookReceiptsTable).values({
        providerEventId: params.event.providerEventId,
        payloadHash: hash,
        status: "processing",
        attempts: 1,
        rawPayload: params.rawBody.slice(0, 50_000),
        normalizedPayload: { channel: params.adapter.channel, kind: params.event.kind },
        retainedUntil: new Date(Date.now() + 14 * 24 * 60 * 60_000),
        processingToken: randomUUID(),
        processingOwner: "connector",
        leaseExpiresAt: new Date(Date.now() + 30_000),
      });
    }
    return "claimed" as const;
  });
  if (claimed === "duplicate") return "duplicate";

  if (params.event.kind === "delivery" || params.event.kind === "read") {
    const mapped = params.adapter.mapDeliveryStatus(params.event.raw);
    if (mapped) {
      const [account] = mapped.providerAccountId
        ? await db
            .select()
            .from(crmChannelAccountsTable)
            .where(
              and(
                eq(crmChannelAccountsTable.channel, params.adapter.channel),
                eq(crmChannelAccountsTable.providerAccountId, mapped.providerAccountId),
              ),
            )
            .limit(1)
        : await db
            .select()
            .from(crmChannelAccountsTable)
            .where(eq(crmChannelAccountsTable.channel, params.adapter.channel))
            .limit(1);
      if (account) {
        const updated = await db
          .update(crmMessagesTable)
          .set({ deliveryStatus: mapped.status, failureClass: mapped.failureClass ?? null })
          .where(
            and(
              eq(crmMessagesTable.channelAccountId, account.id),
              eq(crmMessagesTable.providerMessageId, mapped.providerMessageId),
            ),
          )
          .returning({ id: crmMessagesTable.id });
        if (updated.length === 0) {
          await db
            .insert(crmPendingDeliveriesTable)
            .values({
              channelAccountId: account.id,
              providerMessageId: mapped.providerMessageId,
              status: mapped.status,
              failureClass: mapped.failureClass ?? null,
            })
            .onConflictDoUpdate({
              target: [crmPendingDeliveriesTable.channelAccountId, crmPendingDeliveriesTable.providerMessageId],
              set: {
                status: mapped.status,
                failureClass: mapped.failureClass ?? null,
                receivedAt: new Date(),
              },
            });
        }
      }
      if (mapped.status === "delivered") connectorMetrics.outboundDelivered += 1;
      if (mapped.status === "read") connectorMetrics.outboundRead += 1;
      if (mapped.status === "failed") connectorMetrics.outboundFailed += 1;
    }
    await markReceipt(params.event.providerEventId, "processed");
    return "ok";
  }

  const canonical = params.adapter.normalizeInboundMessage(params.event);
  if (!canonical || !canonical.providerMessageId) {
    connectorMetrics.inboundQuarantined += 1;
    await quarantine("unnormalizable", params.rawBody, params.adapter.channel);
    await markReceipt(params.event.providerEventId, "quarantined");
    return "quarantined";
  }
  try {
    await persistCanonicalMessage(canonical, params.correlationId);
    connectorMetrics.inboundProcessed += 1;
    await markReceipt(params.event.providerEventId, "processed");
    return "ok";
  } catch (err) {
    connectorMetrics.inboundFailed += 1;
    await markReceipt(params.event.providerEventId, "retryable_failed", err instanceof Error ? err.message : "ingest failed");
    throw err;
  }
}

async function markReceipt(id: string, status: string, lastError?: string) {
  await db
    .update(crmWebhookReceiptsTable)
    .set({
      status,
      processedAt: status === "processed" ? new Date() : null,
      lastError: lastError ?? null,
      terminal: status === "quarantined",
      processingToken: null,
      processingOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(crmWebhookReceiptsTable.providerEventId, id));
}

export async function persistCanonicalMessage(
  msg: CanonicalInboundMessage,
  correlationId?: string,
): Promise<{ inquiryId: string; conversationId: string; duplicate?: boolean }> {
  return db.transaction(async (tx) => {
    let [account] = await tx
      .select()
      .from(crmChannelAccountsTable)
      .where(
        and(
          eq(crmChannelAccountsTable.channel, msg.channel),
          eq(crmChannelAccountsTable.providerAccountId, msg.providerAccountId),
        ),
      )
      .limit(1);
    if (!account) {
      [account] = await tx
        .select()
        .from(crmChannelAccountsTable)
        .where(eq(crmChannelAccountsTable.channel, msg.channel))
        .limit(1);
    }
    if (account) {
      const [dup] = await tx
        .select()
        .from(crmMessagesTable)
        .where(
          and(
            eq(crmMessagesTable.channelAccountId, account.id),
            eq(crmMessagesTable.providerMessageId, msg.providerMessageId),
          ),
        )
        .limit(1);
      if (dup) return { inquiryId: dup.inquiryId, conversationId: dup.conversationId, duplicate: true };
    }

    const identity = await resolveChannelIdentity(tx, msg);
    let conversation = account
      ? (
          await tx
            .select()
            .from(crmConversationsTable)
            .where(
              and(
                eq(crmConversationsTable.channelAccountId, account.id),
                eq(crmConversationsTable.externalThreadId, msg.externalThreadId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;

    let inquiryId = conversation?.inquiryId;
    if (!conversation) {
      const reference = await nextReference(tx);
      const [inquiry] = await tx
        .insert(crmInquiriesTable)
        .values({
          reference,
          contactId: identity.contactId,
          status: "NEW",
          priority: "normal",
          source: msg.channel,
          channel: msg.channel === "website" ? "web_form" : msg.channel,
          inquiryType: "general",
          lastCustomerMessageAt: new Date(),
          lastActivityAt: new Date(),
        })
        .returning();
      inquiryId = inquiry.id;
      const [created] = await tx
        .insert(crmConversationsTable)
        .values({
          inquiryId: inquiry.id,
          channel: msg.channel === "website" ? "web_form" : msg.channel,
          status: "open",
          channelAccountId: account?.id ?? null,
          externalThreadId: msg.externalThreadId,
          contactId: identity.contactId,
          subject: msg.subject ?? null,
          lastMessageAt: new Date(),
          lastInboundAt: new Date(),
          unreadCount: 1,
        })
        .returning();
      conversation = created;
      await writeAudit({
        actorType: "system",
        action: "conversation.created",
        entityType: "inquiry",
        entityId: inquiry.id,
        inquiryId: inquiry.id,
        contactId: identity.contactId,
        correlationId,
        afterValue: { channel: msg.channel, identityMethod: identity.method },
      });
    } else {
      await tx
        .update(crmConversationsTable)
        .set({
          lastMessageAt: new Date(),
          lastInboundAt: new Date(),
          unreadCount: sql`${crmConversationsTable.unreadCount} + 1`,
          lockVersion: sql`${crmConversationsTable.lockVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(crmConversationsTable.id, conversation.id));
      await tx
        .update(crmInquiriesTable)
        .set({
          lastActivityAt: new Date(),
          lastCustomerMessageAt: new Date(),
          status: "IN_PROGRESS",
          updatedAt: new Date(),
        })
        .where(eq(crmInquiriesTable.id, conversation.inquiryId));
    }

    const [inserted] = await tx.insert(crmMessagesTable).values({
      conversationId: conversation.id,
      inquiryId: inquiryId!,
      kind: "customer_message",
      visibility: "customer",
      channel: msg.channel === "website" ? "web_form" : msg.channel,
      authorType: "contact",
      authorContactId: identity.contactId,
      subject: msg.subject ?? null,
      body: msg.bodyText,
      bodyHtml: msg.bodyHtml ?? null,
      textBody: msg.bodyText,
      sanitizedHtml: msg.bodyHtml ? sanitizeHtml(msg.bodyHtml) : null,
      providerMessageId: msg.providerMessageId,
      providerEventId: msg.idempotencyKey,
      deliveryStatus: "received",
      direction: msg.direction,
      channelAccountId: account?.id ?? null,
      providerReplyToId: msg.providerReplyToId ?? null,
      senderJson: msg.sender,
      recipientsJson: { recipients: msg.recipients },
      attachmentRefs: msg.attachments,
      providerTimestamp: msg.providerTimestamp ?? null,
      idempotencyKey: msg.idempotencyKey,
      correlationId: correlationId ?? null,
      providerMetadata: msg.allowlistedMetadata,
    }).returning({ id: crmMessagesTable.id });

    if (account && inserted) {
      const [pending] = await tx
        .select()
        .from(crmPendingDeliveriesTable)
        .where(
          and(
            eq(crmPendingDeliveriesTable.channelAccountId, account.id),
            eq(crmPendingDeliveriesTable.providerMessageId, msg.providerMessageId),
          ),
        )
        .limit(1);
      if (pending) {
        await tx
          .update(crmMessagesTable)
          .set({ deliveryStatus: pending.status, failureClass: pending.failureClass ?? null })
          .where(eq(crmMessagesTable.id, inserted.id));
        await tx
          .delete(crmPendingDeliveriesTable)
          .where(eq(crmPendingDeliveriesTable.id, pending.id));
      }
      await recordChannelActivity(tx, account.id, "inbound", null, "fixture");
    }
    await enqueueJob(
      "notify_staff",
      { inquiryId, event: "inbound_message", channel: msg.channel },
      { correlationId, executor: tx },
    );
    return { inquiryId: inquiryId!, conversationId: conversation.id };
  }).then(async (result) => {
    if (!result.duplicate) await onCustomerReply(result.inquiryId).catch(() => undefined);
    return result;
  });
}

export async function ensureWebsiteIdentity(params: {
  contactId: string;
  email: string;
  displayName: string;
  executor?: DbSession;
}): Promise<void> {
  const executor = params.executor ?? db;
  const [existing] = await executor
    .select()
    .from(crmChannelIdentitiesTable)
    .where(
      and(
        eq(crmChannelIdentitiesTable.channel, "website"),
        eq(crmChannelIdentitiesTable.providerUserId, params.email.toLowerCase()),
      ),
    )
    .limit(1);
  if (existing) return;
  await executor.insert(crmChannelIdentitiesTable).values({
    contactId: params.contactId,
    channel: "website",
    providerAccountContext: "contact-form",
    providerUserId: params.email.toLowerCase(),
    normalizedEmail: params.email.toLowerCase(),
    displayName: params.displayName,
    verificationStatus: "verified",
    confidence: "high",
  });
}

export function adapterForChannel(channel: InboxChannel) {
  return getChannelAdapter(channel);
}
