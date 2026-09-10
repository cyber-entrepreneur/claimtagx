import { createHash, createHmac } from "node:crypto";
import type {
  CanonicalInboundMessage,
  ChannelAdapter,
  ChannelAdapterContext,
  DeliveryMapping,
  ParsedInboundEvent,
  SendMessageInput,
  SendMessageResult,
  WebhookVerification,
} from "./types";
import { emptyCapabilities, headerValue } from "./types";
import { asArray, asRecord, healthFromStatus, resolveDeclaredStatus, secretPresent, str } from "./util";
import { verifyXTwitterWebhookSignature } from "./metaSignature";

function xCaps() {
  return emptyCapabilities({
    inbound: true,
    outbound: true,
    attachments: false,
    deliveryReceipts: false,
    reconciliation: false,
    webhooks: true,
    maxMessageBytes: 10_000,
    allowedAttachmentTypes: [],
  });
}

export const xAdapter: ChannelAdapter = {
  channel: "x",
  capabilities: xCaps,
  verifyWebhook(ctx: ChannelAdapterContext): WebhookVerification {
    const crc = typeof ctx.query.crc_token === "string" ? ctx.query.crc_token : undefined;
    const secret = process.env.X_CONSUMER_SECRET?.trim();
    if (crc) {
      if (!secret) return { kind: "rejected", status: 503, reason: "x_not_configured" };
      const responseToken = createHmac("sha256", secret).update(crc).digest("base64");
      return {
        kind: "challenge",
        status: 200,
        body: JSON.stringify({ response_token: `sha256=${responseToken}` }),
        contentType: "application/json",
      };
    }
    if (!secret) {
      return { kind: "rejected", status: ctx.nodeEnv === "production" ? 503 : 401, reason: "x_not_configured" };
    }
    const signature = headerValue(ctx.headers, "x-twitter-webhooks-signature");
    if (!signature) {
      return { kind: "rejected", status: 401, reason: "missing_signature" };
    }
    if (
      !verifyXTwitterWebhookSignature({
        rawBody: ctx.rawBodyBytes ?? ctx.rawBody,
        header: signature,
        consumerSecret: secret,
      })
    ) {
      return { kind: "rejected", status: 401, reason: "bad_signature" };
    }
    return { kind: "accepted" };
  },
  parseInboundEvents(body: unknown): ParsedInboundEvent[] {
    const root = asRecord(body);
    const events: ParsedInboundEvent[] = [];
    for (const item of asArray(root?.direct_message_events)) {
      const dm = asRecord(item);
      const id = str(dm?.id);
      if (!id) continue;
      events.push({ providerEventId: `x:${id}`, kind: "message", raw: { forUserId: str(root?.for_user_id), dm } });
    }
    return events;
  },
  normalizeInboundMessage(event: ParsedInboundEvent): CanonicalInboundMessage | null {
    const wrap = asRecord(event.raw);
    const dm = asRecord(wrap?.dm);
    const id = str(dm?.id);
    const messageCreate = asRecord(dm?.message_create);
    const senderId = str(messageCreate?.sender_id);
    const target = asRecord(messageCreate?.target);
    const text = str(asRecord(messageCreate?.message_data)?.text);
    if (!id || !senderId) return null;
    const account = str(wrap?.forUserId) || "x-account";
    const peer = senderId === account ? str(target?.recipient_id) : senderId;
    return {
      channel: "x",
      providerAccountId: account,
      providerMessageId: id,
      externalThreadId: peer || id,
      providerUserId: senderId,
      direction: senderId === account ? "outbound" : "inbound",
      bodyText: text,
      sender: { providerUserId: senderId },
      recipients: [{ providerUserId: str(target?.recipient_id) }],
      attachments: [],
      idempotencyKey: createHash("sha256").update(`x:${id}`).digest("hex"),
      allowlistedMetadata: { type: str(dm?.type) },
    };
  },
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const token = process.env.X_ACCESS_TOKEN?.trim();
    if (!token) return { accepted: false, error: "x_not_configured", failureClass: "config" };
    const conversationId = input.conversationExternalId;
    const participant = input.toProviderUserId;
    if (!conversationId && !participant) return { accepted: false, error: "missing_recipient", failureClass: "validation" };
    const url = conversationId
      ? `https://api.x.com/2/dm_conversations/${encodeURIComponent(conversationId)}/messages`
      : "https://api.x.com/2/dm_conversations/with_participants";
    const body = conversationId
      ? { text: input.text }
      : { participant_ids: [participant], message: { text: input.text } };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        return { accepted: false, retryable, error: `x_${res.status}`, failureClass: retryable ? "transient" : "permanent" };
      }
      const data = asRecord(json.data);
      return { accepted: true, providerMessageId: str(data?.dm_event_id) || str(data?.id) || undefined };
    } catch (err) {
      return { accepted: false, retryable: true, error: err instanceof Error ? err.message : "x send failed", failureClass: "transient" };
    }
  },
  async reconcileMessage(id) {
    return { accepted: false, uncertain: true, providerMessageId: id, failureClass: "uncertain" };
  },
  mapDeliveryStatus(): DeliveryMapping | null {
    return null;
  },
  async downloadAttachment() {
    return null;
  },
  async refreshCredentials() {
    return { refreshed: false };
  },
  healthCheck() {
    const missing = [
      !secretPresent("X_CONSUMER_SECRET") ? "X_CONSUMER_SECRET" : "",
      !secretPresent("X_ACCESS_TOKEN") ? "X_ACCESS_TOKEN" : "",
      "X developer access / paid API tier",
      "Account Activity webhook registration",
    ].filter(Boolean);
    return healthFromStatus({
      status: resolveDeclaredStatus({
        channel: "x",
        implemented: true,
        credentialsReady: secretPresent("X_CONSUMER_SECRET") && secretPresent("X_ACCESS_TOKEN"),
      }),
      missing,
      credentialConfigured: secretPresent("X_ACCESS_TOKEN"),
    });
  },
};
