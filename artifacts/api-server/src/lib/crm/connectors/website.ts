import { createHash } from "node:crypto";
import type {
  CanonicalInboundMessage,
  ChannelAdapter,
  DeliveryMapping,
  ParsedInboundEvent,
  SendMessageInput,
  SendMessageResult,
  WebhookVerification,
} from "./types";
import { ConnectorCapabilityError, emptyCapabilities } from "./types";
import { healthFromStatus, resolveDeclaredStatus } from "./util";

function websiteCaps() {
  return emptyCapabilities({
    inbound: true,
    outbound: true,
    templates: true,
    maxMessageBytes: 8000,
  });
}

export const websiteAdapter: ChannelAdapter = {
  channel: "website",
  capabilities: websiteCaps,
  verifyWebhook(): WebhookVerification {
    return { kind: "rejected", status: 404, reason: "website_contact_uses_form_not_webhook" };
  },
  parseInboundEvents(): ParsedInboundEvent[] {
    return [];
  },
  normalizeInboundMessage(): CanonicalInboundMessage | null {
    return null;
  },
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const { sendTransactionalEmail } = await import("../../email");
    if (!input.toEmail) {
      throw new ConnectorCapabilityError("Website replies require a contact email", "NO_RECIPIENT");
    }
    try {
      const id = await sendTransactionalEmail({
        to: input.toEmail,
        subject: input.subject ?? "Re: ClaimTagX inquiry",
        text: input.text,
        html: input.html ?? `<p>${input.text}</p>`,
      }, { idempotencyKey: input.idempotencyKey });
      if (!id) return { accepted: false, uncertain: true, failureClass: "uncertain_acceptance" };
      return { accepted: true, providerMessageId: id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "send failed";
      return { accepted: false, retryable: /timeout|429|503|ECONNRESET/i.test(message), error: message, failureClass: "provider_error" };
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
    return healthFromStatus({
      status: resolveDeclaredStatus({
        channel: "website",
        implemented: true,
        credentialsReady: true,
      }),
      missing: [],
      credentialConfigured: true,
    });
  },
};

export function websiteFormToCanonical(params: {
  inquiryId: string;
  contactEmail: string;
  displayName: string;
  body: string;
}): CanonicalInboundMessage {
  const providerMessageId = `website:${params.inquiryId}`;
  return {
    channel: "website",
    providerAccountId: "contact-form",
    providerMessageId,
    externalThreadId: params.inquiryId,
    providerUserId: params.contactEmail.toLowerCase(),
    direction: "inbound",
    bodyText: params.body,
    sender: { email: params.contactEmail, displayName: params.displayName },
    recipients: [],
    attachments: [],
    idempotencyKey: createHash("sha256").update(providerMessageId).digest("hex"),
    allowlistedMetadata: { source: "website_contact" },
    verifiedEmail: params.contactEmail.toLowerCase(),
  };
}
