import { createHash } from "node:crypto";
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
import { ConnectorCapabilityError, emptyCapabilities, headerValue } from "./types";
import { asArray, asRecord, healthFromStatus, hmacSha256Hex, resolveDeclaredStatus, secretPresent, str, timingSafeHexEqual } from "./util";
import { metaSignatureFrom, metaVerifyChallenge, verifyMetaSha256Signature } from "./metaSignature";

const GRAPH = "https://graph.facebook.com/v21.0";

export function whatsappCaps() {
  return emptyCapabilities({
    inbound: true,
    outbound: true,
    attachments: false,
    templates: true,
    readReceipts: true,
    deliveryReceipts: true,
    reconciliation: false,
    replyWindowHours: 24,
    webhooks: true,
    maxMessageBytes: 4096,
    allowedAttachmentTypes: [],
  });
}

export function buildWhatsAppSendPayload(input: SendMessageInput): Record<string, unknown> {
  const to = (input.toPhone ?? input.toProviderUserId ?? "").replace(/^\+/, "");
  if (input.templateName) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: input.templateName, language: { code: input.templateLanguage ?? "en" } },
    };
  }
  return { messaging_product: "whatsapp", to, type: "text", text: { body: input.text } };
}

function credentialsReady() {
  return secretPresent("WHATSAPP_ACCESS_TOKEN") && secretPresent("WHATSAPP_PHONE_NUMBER_ID") && secretPresent("WHATSAPP_APP_SECRET");
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  capabilities: whatsappCaps,
  verifyWebhook(ctx: ChannelAdapterContext): WebhookVerification {
    const challenge = metaVerifyChallenge(ctx.query, process.env.WHATSAPP_VERIFY_TOKEN ?? "");
    if (challenge) return { kind: "challenge", status: 200, body: challenge, contentType: "text/plain" };
    const secret = process.env.WHATSAPP_APP_SECRET ?? "";
    if (!secret) {
      return ctx.nodeEnv === "production"
        ? { kind: "rejected", status: 503, reason: "whatsapp_not_configured" }
        : { kind: "rejected", status: 401, reason: "whatsapp_not_configured" };
    }
    const sig = metaSignatureFrom(ctx);
    if (!sig) return { kind: "rejected", status: 401, reason: "missing_signature" };
    if (!verifyMetaSha256Signature({ rawBody: ctx.rawBodyBytes ?? ctx.rawBody, header: sig, appSecret: secret })) {
      return { kind: "rejected", status: 401, reason: "bad_signature" };
    }
    return { kind: "accepted" };
  },
  parseInboundEvents(body: unknown): ParsedInboundEvent[] {
    const root = asRecord(body);
    const events: ParsedInboundEvent[] = [];
    for (const entry of asArray(root?.entry)) {
      const e = asRecord(entry);
      for (const change of asArray(e?.changes)) {
        const value = asRecord(asRecord(change)?.value);
        if (!value) continue;
        for (const msg of asArray(value.messages)) {
          const m = asRecord(msg);
          const id = str(m?.id);
          if (!id) continue;
          events.push({ providerEventId: `whatsapp:${id}`, kind: "message", raw: { value, message: m } });
        }
        for (const st of asArray(value.statuses)) {
          const s = asRecord(st);
          const id = str(s?.id);
          if (!id) continue;
          const status = str(s?.status);
          events.push({
            providerEventId: `whatsapp-status:${id}:${status}`,
            kind: status === "read" ? "read" : "delivery",
            raw: { ...s, phone_number_id: str(asRecord(value.metadata)?.phone_number_id) },
          });
        }
      }
    }
    return events;
  },
  normalizeInboundMessage(event: ParsedInboundEvent): CanonicalInboundMessage | null {
    if (event.kind !== "message") return null;
    const wrap = asRecord(event.raw);
    const value = asRecord(wrap?.value);
    const message = asRecord(wrap?.message);
    if (!message) return null;
    const id = str(message.id);
    const from = str(message.from);
    const text = str(asRecord(message.text)?.body) || str(asRecord(message.button)?.text);
    const phoneId = str(asRecord(value?.metadata)?.phone_number_id) || "cloud-api";
    const contact = asRecord(asArray(value?.contacts)[0]);
    const name = str(asRecord(contact?.profile)?.name);
    return {
      channel: "whatsapp",
      providerAccountId: phoneId,
      providerMessageId: id,
      providerReplyToId: str(asRecord(message.context)?.id) || undefined,
      externalThreadId: from,
      providerUserId: from,
      direction: "inbound",
      bodyText: text,
      sender: { providerUserId: from, phone: from.startsWith("+") ? from : `+${from}`, displayName: name || undefined },
      recipients: [],
      attachments: [],
      providerTimestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : undefined,
      idempotencyKey: createHash("sha256").update(`whatsapp:${id}`).digest("hex"),
      allowlistedMetadata: { type: str(message.type) },
      verifiedPhone: from ? (from.startsWith("+") ? from : `+${from}`) : undefined,
    };
  },
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    if (!whatsappCaps().outbound) throw new ConnectorCapabilityError("WhatsApp outbound disabled", "NO_OUTBOUND");
    const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    if (!token || !phoneId) {
      if (process.env.NODE_ENV === "production") {
        return { accepted: false, error: "whatsapp_not_configured", failureClass: "config" };
      }
      return { accepted: false, error: "whatsapp_not_configured", failureClass: "config" };
    }
    const to = (input.toPhone ?? input.toProviderUserId ?? "").replace(/^\+/, "");
    if (!to) return { accepted: false, error: "missing_recipient", failureClass: "validation" };
    const payload = buildWhatsAppSendPayload(input);
    try {
      const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        return { accepted: false, retryable, error: `whatsapp_${res.status}`, failureClass: retryable ? "transient" : "permanent" };
      }
      const messages = asArray(json.messages);
      const id = str(asRecord(messages[0])?.id);
      return { accepted: true, providerMessageId: id || undefined, providerRequestId: headerValue({ "x-fb-request-id": undefined }, "x") };
    } catch (err) {
      const message = err instanceof Error ? err.message : "whatsapp send failed";
      return { accepted: false, retryable: true, error: message, failureClass: "transient" };
    }
  },
  async reconcileMessage(providerMessageId: string): Promise<SendMessageResult> {
    return { accepted: false, uncertain: true, providerMessageId, failureClass: "uncertain" };
  },
  mapDeliveryStatus(payload: unknown): DeliveryMapping | null {
    const s = asRecord(payload);
    const id = str(s?.id);
    const status = str(s?.status);
    if (!id || !status) return null;
    const mapped =
      status === "read"
        ? "read"
        : status === "delivered"
          ? "delivered"
          : status === "sent" || status === "accepted"
            ? "accepted"
            : status === "failed"
              ? "failed"
              : "uncertain";
    return {
      providerMessageId: id,
      status: mapped,
      failureClass: mapped === "failed" ? "provider_error" : undefined,
      providerAccountId: str(s?.phone_number_id) || undefined,
    };
  },
  async downloadAttachment() {
    return null;
  },
  async refreshCredentials() {
    return { refreshed: false };
  },
  healthCheck() {
    const missing = [
      !secretPresent("WHATSAPP_ACCESS_TOKEN") ? "WHATSAPP_ACCESS_TOKEN" : "",
      !secretPresent("WHATSAPP_PHONE_NUMBER_ID") ? "WHATSAPP_PHONE_NUMBER_ID" : "",
      !secretPresent("WHATSAPP_APP_SECRET") ? "WHATSAPP_APP_SECRET" : "",
      !secretPresent("WHATSAPP_VERIFY_TOKEN") ? "WHATSAPP_VERIFY_TOKEN" : "",
    ].filter(Boolean);
    return healthFromStatus({
      status: resolveDeclaredStatus({
        channel: "whatsapp",
        implemented: true,
        credentialsReady: credentialsReady(),
        appReviewPending: process.env.WHATSAPP_APP_REVIEW === "true",
      }),
      missing: [
        ...missing,
        "Attachments temporarily unavailable pending controlled download",
      ],
      credentialConfigured: credentialsReady(),
    });
  },
};

export function whatsappCrcUnused(secret: string, token: string): boolean {
  return timingSafeHexEqual(hmacSha256Hex(secret, token), hmacSha256Hex(secret, token));
}
