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
import { emptyCapabilities } from "./types";
import { healthFromStatus, resolveDeclaredStatus, secretPresent } from "./util";
import {
  graphNotificationAuthorized,
  graphNotificationEventId,
  parseGraphNotifications,
  respondGraphValidationToken,
} from "../microsoftGraph/webhookSecurity";
import { loadMicrosoftGraphConfig, validateMicrosoftGraphConfig } from "../microsoftGraph/config";

function graphCaps() {
  return emptyCapabilities({
    inbound: true,
    outbound: true,
    attachments: false,
    templates: true,
    readReceipts: false,
    deliveryReceipts: false,
    reconciliation: false,
    webhooks: true,
    polling: true,
    maxMessageBytes: 10 * 1024 * 1024,
    allowedAttachmentTypes: [],
  });
}

export const microsoft365Adapter: ChannelAdapter = {
  channel: "microsoft365",
  capabilities: graphCaps,
  verifyWebhook(ctx: ChannelAdapterContext): WebhookVerification {
    const token = typeof ctx.query.validationToken === "string" ? ctx.query.validationToken : undefined;
    if (token) {
      const response = respondGraphValidationToken(token);
      return { kind: "challenge", status: response.status, body: response.body, contentType: response.contentType };
    }
    const config = loadMicrosoftGraphConfig();
    if (!config) {
      if (ctx.nodeEnv === "production") return { kind: "rejected", status: 503, reason: "graph_not_configured" };
      return { kind: "rejected", status: 401, reason: "graph_not_configured" };
    }
    const notifications = parseGraphNotifications(ctx.body);
    const authz = graphNotificationAuthorized(config, notifications);
    if (!authz.ok) return { kind: "rejected", status: 401, reason: authz.reason ?? "unauthorized" };
    return { kind: "accepted" };
  },
  parseInboundEvents(body: unknown): ParsedInboundEvent[] {
    return parseGraphNotifications(body).map((notification) => ({
      providerEventId: graphNotificationEventId(notification),
      kind: "message" as const,
      raw: notification,
    }));
  },
  normalizeInboundMessage(event: ParsedInboundEvent): CanonicalInboundMessage | null {
    const raw = event.raw as { resourceData?: { id?: string } };
    const messageId = raw.resourceData?.id;
    if (!messageId) return null;
    return {
      channel: "microsoft365",
      providerAccountId: process.env.MS_GRAPH_MAILBOX_UPN ?? "exchange-mailbox",
      providerMessageId: messageId,
      externalThreadId: messageId,
      providerUserId: messageId,
      direction: "inbound",
      bodyText: "",
      sender: {},
      recipients: [],
      attachments: [],
      idempotencyKey: createHash("sha256").update(`graph:${messageId}`).digest("hex"),
      allowlistedMetadata: { graphResource: true },
    };
  },
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const { getEmailProvider } = await import("../emailProvider");
    if (!input.toEmail) return { accepted: false, error: "missing_recipient_email", failureClass: "validation" };
    try {
      const result = await getEmailProvider().send({
        to: input.toEmail,
        subject: input.subject ?? "Re: ClaimTagX",
        html: input.html ?? `<p>${input.text}</p>`,
        text: input.text,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        accepted: Boolean(result.providerMessageId),
        providerMessageId: result.providerMessageId ?? undefined,
        providerRequestId: result.providerRequestId ?? undefined,
        uncertain: !result.providerMessageId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "graph send failed";
      return { accepted: false, retryable: /429|503|timeout|ECONNRESET/i.test(message), error: message, failureClass: "provider_error" };
    }
  },
  async reconcileMessage(): Promise<SendMessageResult> {
    return { accepted: false, uncertain: true, failureClass: "uncertain" };
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
    const validated = validateMicrosoftGraphConfig();
    const ready = validated.ok;
    const missing = ready ? [] : validated.issues.map((i) => `${i.field}: ${i.message}`);
    return healthFromStatus({
      status: resolveDeclaredStatus({
        channel: "microsoft365",
        implemented: true,
        credentialsReady: ready,
      }),
      missing: missing.length
        ? missing
        : ["Entra tenant", "Exchange mailbox", "admin consent", "Attachments temporarily unavailable pending controlled download"],
      credentialConfigured: secretPresent("MS_GRAPH_TENANT_ID") && secretPresent("MS_GRAPH_CLIENT_ID"),
    });
  },
};
