import {
  db,
  crmContactsTable,
  crmConversationsTable,
  crmInquiriesTable,
  crmMessagesTable,
  type DbSession,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { insertPendingEffect } from "../effects";
import { enqueueJob } from "../queue";
import { sanitizeHtml } from "../htmlSanitize";
import { writeAudit } from "../audit";
import { ConnectorCapabilityError } from "./types";
import { connectorMetrics } from "./metrics";
import { getChannelAdapter, inquiryChannelToInbox } from "./registry";
import { recordChannelActivity } from "./statusEvidence";
import { firstPartyEvidenceBlocked, redactProviderError } from "./util";
import type { JobRunContext } from "../queue";
import { assertJobOwned } from "../queue";
import { transitionEffect, claimEffectForWork } from "../effects";

export async function queueStaffReply(params: {
  inquiryId: string;
  staffId: string;
  body: string;
  html?: string;
  subject?: string;
  executor?: DbSession;
  conversationId?: string;
}): Promise<{ messageId: string; deliveryStatus: string; disabledReason?: string }> {
  const executor = params.executor ?? db;
  const [inquiry] = await executor
    .select()
    .from(crmInquiriesTable)
    .where(eq(crmInquiriesTable.id, params.inquiryId))
    .limit(1);
  if (!inquiry) throw Object.assign(new Error("Inquiry not found"), { status: 404 });
  const [conversation] = params.conversationId
    ? await executor.select().from(crmConversationsTable).where(eq(crmConversationsTable.id, params.conversationId)).limit(1)
    : await executor.select().from(crmConversationsTable).where(eq(crmConversationsTable.inquiryId, inquiry.id)).limit(1);
  if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
  const inboxChannel = inquiryChannelToInbox(conversation.channel || inquiry.channel);
  const adapter = getChannelAdapter(inboxChannel);
  const caps = adapter.capabilities();
  if (!caps.outbound) {
    throw new ConnectorCapabilityError(
      caps.manualHandoff
        ? `${inboxChannel} does not support in-product replies. Use the provider handoff.`
        : `Replies are not supported on ${inboxChannel}`,
      caps.manualHandoff ? "MANUAL_HANDOFF" : "NO_OUTBOUND",
    );
  }
  if (caps.replyWindowHours && conversation.lastInboundAt) {
    const ageH = (Date.now() - conversation.lastInboundAt.getTime()) / 3600_000;
    if (ageH > caps.replyWindowHours) {
      throw new ConnectorCapabilityError(
        `The ${caps.replyWindowHours}h provider reply window has closed`,
        "REPLY_WINDOW_CLOSED",
      );
    }
  }
  const [contact] = await executor
    .select()
    .from(crmContactsTable)
    .where(eq(crmContactsTable.id, inquiry.contactId))
    .limit(1);
  const [msg] = await executor
    .insert(crmMessagesTable)
    .values({
      conversationId: conversation.id,
      inquiryId: inquiry.id,
      kind: "staff_reply",
      visibility: "customer",
      channel: conversation.channel,
      authorType: "staff",
      authorStaffId: params.staffId,
      authorContactId: inquiry.contactId,
      subject: params.subject ?? null,
      body: params.body,
      bodyHtml: params.html ?? null,
      textBody: params.body,
      sanitizedHtml: params.html ? sanitizeHtml(params.html) : null,
      deliveryStatus: "queued",
      direction: "outbound",
      channelAccountId: conversation.channelAccountId,
      idempotencyKey: `outbound:${inquiry.id}:${Date.now()}`,
    })
    .returning();
  const effectKey = `outbound:${msg.id}`;
  await insertPendingEffect({
    key: effectKey,
    kind: "connector_outbound",
    payload: { messageId: msg.id, inquiryId: inquiry.id, channel: inboxChannel },
    executor,
    providerIdempotencyKey: effectKey,
  });
  await enqueueJob(
    "connector_outbound",
    {
      messageId: msg.id,
      inquiryId: inquiry.id,
      conversationId: conversation.id,
      channel: inboxChannel,
      toEmail: contact?.email,
      toPhone: contact?.phoneE164,
      text: params.body,
      html: params.html,
      subject: params.subject,
      effectKey,
    },
    { executor, idempotencyKey: effectKey, causationId: msg.id },
  );
  connectorMetrics.outboundQueued += 1;
  return { messageId: msg.id, deliveryStatus: "queued" };
}

export async function processConnectorOutbound(
  payload: Record<string, unknown>,
  ctx: JobRunContext,
): Promise<void> {
  await assertJobOwned(ctx);
  const messageId = String(payload.messageId ?? "");
  const channel = inquiryChannelToInbox(String(payload.channel ?? "website"));
  const adapter = getChannelAdapter(channel);
  const effectKey = typeof payload.effectKey === "string" && payload.effectKey ? payload.effectKey : `outbound:${messageId}`;
  const lease = await db.transaction(async (tx) =>
    claimEffectForWork(tx, {
      key: effectKey,
      kind: "connector_outbound",
      payload: { messageId, channel },
      ctx,
      providerIdempotencyKey: effectKey,
    }),
  );
  if (!lease) return;
  await db
    .update(crmMessagesTable)
    .set({ deliveryStatus: "sending" })
    .where(eq(crmMessagesTable.id, messageId));
  const [conversation] = await db
    .select()
    .from(crmConversationsTable)
    .where(eq(crmConversationsTable.id, String(payload.conversationId ?? "")))
    .limit(1);
  const result = await adapter.sendMessage({
    channelAccountId: conversation?.channelAccountId ?? "",
    conversationExternalId: conversation?.externalThreadId ?? undefined,
    toEmail: typeof payload.toEmail === "string" ? payload.toEmail : undefined,
    toPhone: typeof payload.toPhone === "string" ? payload.toPhone : undefined,
    toProviderUserId: conversation?.externalThreadId ?? undefined,
    text: String(payload.text ?? ""),
    html: typeof payload.html === "string" ? payload.html : undefined,
    subject: typeof payload.subject === "string" ? payload.subject : undefined,
    idempotencyKey: effectKey,
  });
  await db.transaction(async (tx) => {
    if (result.accepted) {
      connectorMetrics.outboundAccepted += 1;
      await tx
        .update(crmMessagesTable)
        .set({
          deliveryStatus: "accepted",
          providerMessageId: result.providerMessageId ?? null,
        })
        .where(eq(crmMessagesTable.id, messageId));
      if (conversation?.channelAccountId) {
        await recordChannelActivity(
          tx,
          conversation.channelAccountId,
          "outbound",
          null,
          firstPartyEvidenceBlocked() ? "simulator" : "fixture",
        );
      }
      await transitionEffect(tx, lease, ["executing", "provider_request_started"], {
        status: "accepted",
        providerMessageId: result.providerMessageId ?? null,
        providerRequestId: result.providerRequestId ?? null,
        committed: true,
      });
      return;
    }
    if (result.uncertain) {
      connectorMetrics.outboundUncertain += 1;
      await tx.update(crmMessagesTable).set({ deliveryStatus: "uncertain" }).where(eq(crmMessagesTable.id, messageId));
      await transitionEffect(tx, lease, ["executing", "provider_request_started"], {
        status: "uncertain",
        lastError: redactProviderError(result.error ?? "uncertain_acceptance"),
      });
      return;
    }
    connectorMetrics.outboundFailed += 1;
    await tx
      .update(crmMessagesTable)
      .set({ deliveryStatus: "failed", failureClass: result.failureClass ?? "provider_error" })
      .where(eq(crmMessagesTable.id, messageId));
    if (result.retryable) {
      await transitionEffect(tx, lease, ["executing", "provider_request_started"], {
        status: "retryable_failed",
        lastError: redactProviderError(result.error ?? "send failed"),
      });
      throw new Error(redactProviderError(result.error ?? "provider send failed"));
    }
    await transitionEffect(tx, lease, ["executing", "provider_request_started"], {
      status: "terminal_failed",
      lastError: redactProviderError(result.error ?? "permanent failure"),
      failed: true,
    });
  });
}

export async function retryOutboundMessage(params: {
  messageId: string;
  staffId: string;
}): Promise<{ deliveryStatus: string }> {
  const [msg] = await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.id, params.messageId)).limit(1);
  if (!msg) throw Object.assign(new Error("Message not found"), { status: 404 });
  if (!["failed", "uncertain", "queued"].includes(msg.deliveryStatus ?? "")) {
    throw Object.assign(new Error("Only failed or uncertain outbound messages can be retried"), { status: 409 });
  }
  const [inquiry] = await db.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.id, msg.inquiryId)).limit(1);
  const [contact] = inquiry
    ? await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, inquiry.contactId)).limit(1)
    : [];
  const retryKey = `outbound-retry:${msg.id}:${Date.now()}`;
  await db.update(crmMessagesTable).set({ deliveryStatus: "queued", failureClass: null }).where(eq(crmMessagesTable.id, msg.id));
  await insertPendingEffect({
    key: retryKey,
    kind: "connector_outbound",
    payload: { messageId: msg.id, inquiryId: msg.inquiryId, retryOf: `outbound:${msg.id}` },
    providerIdempotencyKey: retryKey,
  });
  await enqueueJob(
    "connector_outbound",
    {
      messageId: msg.id,
      inquiryId: msg.inquiryId,
      conversationId: msg.conversationId,
      channel: inquiryChannelToInbox(msg.channel),
      toEmail: contact?.email,
      toPhone: contact?.phoneE164,
      text: msg.body,
      html: msg.bodyHtml,
      subject: msg.subject,
      effectKey: retryKey,
    },
    { idempotencyKey: retryKey, causationId: msg.id },
  );
  await writeAudit({
    actorType: "staff",
    actorId: params.staffId,
    action: "outbound.retried",
    entityType: "message",
    entityId: msg.id,
    inquiryId: msg.inquiryId,
    afterValue: { previousStatus: msg.deliveryStatus, effectKey: retryKey },
  });
  return { deliveryStatus: "queued" };
}

export async function reconcileOutboundMessage(params: {
  messageId: string;
  staffId: string;
}): Promise<{ deliveryStatus: string; uncertain: boolean }> {
  const [msg] = await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.id, params.messageId)).limit(1);
  if (!msg) throw Object.assign(new Error("Message not found"), { status: 404 });
  const adapter = getChannelAdapter(inquiryChannelToInbox(msg.channel));
  if (!adapter.capabilities().reconciliation) {
    throw new ConnectorCapabilityError("This channel does not implement delivery reconciliation", "NO_RECONCILE");
  }
  const result = await adapter.reconcileMessage(msg.providerMessageId ?? msg.id);
  const status = result.accepted ? "accepted" : result.uncertain ? "uncertain" : "failed";
  await db
    .update(crmMessagesTable)
    .set({
      deliveryStatus: status,
      failureClass: result.failureClass ?? null,
      providerMessageId: result.providerMessageId ?? msg.providerMessageId,
    })
    .where(eq(crmMessagesTable.id, msg.id));
  await writeAudit({
    actorType: "staff",
    actorId: params.staffId,
    action: "outbound.reconciled",
    entityType: "message",
    entityId: msg.id,
    inquiryId: msg.inquiryId,
    afterValue: { status, error: result.error ? redactProviderError(result.error) : null },
  });
  return { deliveryStatus: status, uncertain: Boolean(result.uncertain) };
}
