import {
  associateToConversation,
  buildThreadingHeaders,
  idempotentWebhookEvent,
  parseInboundHeaders,
  type ConversationAssociation,
  type WebhookEventStore,
} from "./emailThreading";

export type StoredMessage = {
  inquiryId: string;
  conversationId: string;
  reference: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  kind: string;
};

export type QuarantineRecord = {
  reason: "unknown_thread";
  subject: string | null;
  messageId: string | null;
  inReplyTo: string | null;
};

export type InboundResult =
  | { matched: true; duplicate?: boolean; inquiryId: string; reference: string }
  | { matched: false; quarantine: QuarantineRecord };

/**
 * Provider-neutral inbound association used by the webhook and proven by
 * outbound → inbound tests without requiring a live database.
 */
export function associateInboundMessage(input: {
  subject?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  messages: StoredMessage[];
}): { association: ConversationAssociation; inquiryId: string | null } {
  const parsed = parseInboundHeaders({
    messageId: input.messageId,
    inReplyTo: input.inReplyTo,
    references: input.references,
  });
  const association = associateToConversation({
    subject: input.subject,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
  });
  let inquiryId: string | null = null;
  if (association.reference) {
    inquiryId = input.messages.find((m) => m.reference === association.reference)?.inquiryId ?? null;
  }
  if (!inquiryId && association.parentMessageId) {
    inquiryId =
      input.messages.find(
        (m) => m.messageId === association.parentMessageId,
      )?.inquiryId ?? null;
  }
  return { association, inquiryId };
}

export async function processInboundWithIdempotency(input: {
  providerEventId?: string;
  subject?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  messages: StoredMessage[];
  store: WebhookEventStore;
}): Promise<InboundResult> {
  if (input.providerEventId) {
    const claim = await idempotentWebhookEvent(input.providerEventId, input.store);
    if (claim.duplicate) {
      const prior = associateInboundMessage(input);
      if (prior.inquiryId) {
        const msg = input.messages.find((m) => m.inquiryId === prior.inquiryId)!;
        return { matched: true, duplicate: true, inquiryId: prior.inquiryId, reference: msg.reference };
      }
    }
  }
  const { association, inquiryId } = associateInboundMessage(input);
  if (!inquiryId) {
    return {
      matched: false,
      quarantine: {
        reason: "unknown_thread",
        subject: input.subject ?? null,
        messageId: association.parentMessageId,
        inReplyTo: association.parentMessageId,
      },
    };
  }
  const msg = input.messages.find((m) => m.inquiryId === inquiryId)!;
  return { matched: true, inquiryId, reference: msg.reference };
}

export function recordOutboundReply(params: {
  inquiryId: string;
  conversationId: string;
  reference: string;
  parent?: { messageId: string; referencesHeader?: string | null };
}): StoredMessage {
  const headers = buildThreadingHeaders(params.parent, "claimtagx.com");
  return {
    inquiryId: params.inquiryId,
    conversationId: params.conversationId,
    reference: params.reference,
    messageId: headers.messageId,
    inReplyTo: headers.inReplyTo,
    references: headers.references,
    kind: "staff_email",
  };
}
