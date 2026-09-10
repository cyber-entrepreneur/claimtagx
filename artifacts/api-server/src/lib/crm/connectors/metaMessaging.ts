import { createHash } from "node:crypto";
import type {
  CanonicalInboundMessage,
  ChannelAdapter,
  ChannelAdapterContext,
  DeliveryMapping,
  InboxChannel,
  ParsedInboundEvent,
  SendMessageInput,
  SendMessageResult,
  WebhookVerification,
} from "./types";
import { emptyCapabilities } from "./types";
import { asArray, asRecord, healthFromStatus, resolveDeclaredStatus, secretPresent, str } from "./util";
import { metaSignatureFrom, metaVerifyChallenge, verifyMetaSha256Signature } from "./metaSignature";

const GRAPH = "https://graph.facebook.com/v21.0";

function metaMessagingCaps(max: number) {
  return emptyCapabilities({
    inbound: true,
    outbound: true,
    attachments: false,
    readReceipts: false,
    deliveryReceipts: true,
    reconciliation: false,
    replyWindowHours: 24,
    webhooks: true,
    maxMessageBytes: max,
    allowedAttachmentTypes: [],
  });
}

function parseMessaging(body: unknown, objectName: string, channel: InboxChannel): ParsedInboundEvent[] {
  const root = asRecord(body);
  if (str(root?.object) && str(root?.object) !== objectName && str(root?.object) !== "page" && str(root?.object) !== "instagram") {
    return [];
  }
  const events: ParsedInboundEvent[] = [];
  for (const entry of asArray(root?.entry)) {
    const e = asRecord(entry);
    const pageId = str(e?.id);
    for (const item of asArray(e?.messaging)) {
      const m = asRecord(item);
      if (!m) continue;
      const message = asRecord(m.message);
      const delivery = asRecord(m.delivery);
      const read = asRecord(m.read);
      if (message) {
        const mid = str(message.mid);
        if (!mid) continue;
        events.push({ providerEventId: `${channel}:${mid}`, kind: "message", raw: { pageId, item: m } });
      } else if (delivery) {
        for (const mid of asArray(delivery.mids).map(str).filter(Boolean)) {
          events.push({ providerEventId: `${channel}-delivery:${mid}`, kind: "delivery", raw: { mid, pageId } });
        }
      } else if (read) {
        events.push({ providerEventId: `${channel}-read:${pageId}:${str(read.watermark)}`, kind: "read", raw: { pageId, read } });
      }
    }
  }
  return events;
}

function normalizeMessaging(event: ParsedInboundEvent, channel: InboxChannel): CanonicalInboundMessage | null {
  if (event.kind !== "message") return null;
  const wrap = asRecord(event.raw);
  const item = asRecord(wrap?.item);
  const message = asRecord(item?.message);
  const sender = asRecord(item?.sender);
  const recipient = asRecord(item?.recipient);
  const mid = str(message?.mid);
  const psid = str(sender?.id);
  if (!mid || !psid) return null;
  return {
    channel,
    providerAccountId: str(wrap?.pageId) || str(recipient?.id) || "page",
    providerMessageId: mid,
    providerReplyToId: str(asRecord(message?.reply_to)?.mid) || undefined,
    externalThreadId: psid,
    providerUserId: psid,
    direction: "inbound",
    bodyText: str(message?.text),
    sender: { providerUserId: psid },
    recipients: [{ providerUserId: str(recipient?.id) }],
    attachments: [],
    providerTimestamp: item?.timestamp ? new Date(Number(item.timestamp)) : undefined,
    idempotencyKey: createHash("sha256").update(`${channel}:${mid}`).digest("hex"),
    allowlistedMetadata: { isEcho: Boolean(message?.is_echo) },
  };
}

async function sendPageMessage(input: SendMessageInput, tokenEnv: string): Promise<SendMessageResult> {
  const token = process.env[tokenEnv]?.trim() || process.env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!token) return { accepted: false, error: "meta_token_missing", failureClass: "config" };
  const to = input.toProviderUserId;
  if (!to) return { accepted: false, error: "missing_recipient", failureClass: "validation" };
  try {
    const res = await fetch(`${GRAPH}/me/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, message: { text: input.text }, messaging_type: "RESPONSE" }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      return { accepted: false, retryable, error: `meta_${res.status}`, failureClass: retryable ? "transient" : "permanent" };
    }
    return { accepted: true, providerMessageId: str(json.message_id) || undefined };
  } catch (err) {
    return { accepted: false, retryable: true, error: err instanceof Error ? err.message : "meta send failed", failureClass: "transient" };
  }
}

function verifyMeta(ctx: ChannelAdapterContext): WebhookVerification {
  const challenge = metaVerifyChallenge(ctx.query, process.env.META_VERIFY_TOKEN ?? process.env.WHATSAPP_VERIFY_TOKEN ?? "");
  if (challenge) return { kind: "challenge", status: 200, body: challenge, contentType: "text/plain" };
  const secret = process.env.META_APP_SECRET ?? process.env.WHATSAPP_APP_SECRET ?? "";
  if (!secret) {
    return { kind: "rejected", status: ctx.nodeEnv === "production" ? 503 : 401, reason: "meta_not_configured" };
  }
  const sig = metaSignatureFrom(ctx);
  if (!sig) return { kind: "rejected", status: 401, reason: "missing_signature" };
  if (!verifyMetaSha256Signature({ rawBody: ctx.rawBodyBytes ?? ctx.rawBody, header: sig, appSecret: secret })) {
    return { kind: "rejected", status: 401, reason: "bad_signature" };
  }
  return { kind: "accepted" };
}

export const messengerAdapter: ChannelAdapter = {
  channel: "messenger",
  capabilities: () => metaMessagingCaps(2000),
  verifyWebhook: verifyMeta,
  parseInboundEvents: (body) => parseMessaging(body, "page", "messenger"),
  normalizeInboundMessage: (event) => normalizeMessaging(event, "messenger"),
  sendMessage: (input) => sendPageMessage(input, "MESSENGER_PAGE_ACCESS_TOKEN"),
  async reconcileMessage(id) {
    return { accepted: false, uncertain: true, providerMessageId: id, failureClass: "uncertain" };
  },
  mapDeliveryStatus(payload): DeliveryMapping | null {
    const rec = asRecord(payload);
    const mid = str(rec?.mid);
    if (!mid) return null;
    return { providerMessageId: mid, status: "delivered", providerAccountId: str(rec?.pageId) || undefined };
  },
  async downloadAttachment() {
    return null;
  },
  async refreshCredentials() {
    return { refreshed: false };
  },
  healthCheck() {
    const token = secretPresent("MESSENGER_PAGE_ACCESS_TOKEN") || secretPresent("META_PAGE_ACCESS_TOKEN");
    const missing = [
      !secretPresent("META_APP_SECRET") && !secretPresent("WHATSAPP_APP_SECRET") ? "META_APP_SECRET" : "",
      !token ? "MESSENGER_PAGE_ACCESS_TOKEN" : "",
      !secretPresent("META_VERIFY_TOKEN") ? "META_VERIFY_TOKEN" : "",
    ].filter(Boolean);
    return healthFromStatus({
      status: resolveDeclaredStatus({
        channel: "messenger",
        implemented: true,
        credentialsReady: token && secretPresent("META_APP_SECRET"),
        appReviewPending: process.env.META_APP_REVIEW === "true",
      }),
      missing,
      credentialConfigured: token,
    });
  },
};

export const instagramAdapter: ChannelAdapter = {
  channel: "instagram",
  capabilities: () => metaMessagingCaps(1000),
  verifyWebhook: verifyMeta,
  parseInboundEvents: (body) => parseMessaging(body, "instagram", "instagram"),
  normalizeInboundMessage: (event) => normalizeMessaging(event, "instagram"),
  sendMessage: (input) => sendPageMessage(input, "INSTAGRAM_PAGE_ACCESS_TOKEN"),
  async reconcileMessage(id) {
    return { accepted: false, uncertain: true, providerMessageId: id, failureClass: "uncertain" };
  },
  mapDeliveryStatus(payload): DeliveryMapping | null {
    const rec = asRecord(payload);
    const mid = str(rec?.mid);
    if (!mid) return null;
    return { providerMessageId: mid, status: "delivered", providerAccountId: str(rec?.pageId) || undefined };
  },
  async downloadAttachment() {
    return null;
  },
  async refreshCredentials() {
    return { refreshed: false };
  },
  healthCheck() {
    const token = secretPresent("INSTAGRAM_PAGE_ACCESS_TOKEN") || secretPresent("META_PAGE_ACCESS_TOKEN");
    const missing = [
      !secretPresent("META_APP_SECRET") ? "META_APP_SECRET" : "",
      !token ? "INSTAGRAM_PAGE_ACCESS_TOKEN" : "",
      "Instagram professional account connected to a Page",
    ].filter(Boolean);
    return healthFromStatus({
      status: resolveDeclaredStatus({
        channel: "instagram",
        implemented: true,
        credentialsReady: token && secretPresent("META_APP_SECRET"),
        appReviewPending: process.env.META_APP_REVIEW === "true",
      }),
      missing,
      credentialConfigured: token,
    });
  },
};
