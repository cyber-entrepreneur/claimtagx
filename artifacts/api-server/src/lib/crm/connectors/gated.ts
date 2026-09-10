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

export const TIKTOK_HANDOFF_URL = "https://www.tiktok.com/messages";
export const LINKEDIN_HANDOFF_URL = "https://www.linkedin.com/messaging/";

function gatedCaps() {
  return emptyCapabilities({ manualHandoff: true });
}

export const tiktokAdapter: ChannelAdapter = {
  channel: "tiktok",
  capabilities: gatedCaps,
  verifyWebhook(): WebhookVerification {
    return { kind: "rejected", status: 404, reason: "tiktok_has_no_public_support_dm_api" };
  },
  parseInboundEvents(): ParsedInboundEvent[] {
    return [];
  },
  normalizeInboundMessage(): CanonicalInboundMessage | null {
    return null;
  },
  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    throw new ConnectorCapabilityError(
      "TikTok has no official public real-time customer-support DM API. Use the manual handoff.",
      "UNSUPPORTED_BY_PUBLIC_API",
    );
  },
  async reconcileMessage(): Promise<SendMessageResult> {
    throw new ConnectorCapabilityError("TikTok messaging is unsupported", "UNSUPPORTED_BY_PUBLIC_API");
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
        channel: "tiktok",
        implemented: false,
        credentialsReady: false,
        unsupported: true,
      }),
      missing: ["Official real-time customer-support DM API is not publicly available"],
      credentialConfigured: false,
    });
  },
};

export const linkedinAdapter: ChannelAdapter = {
  channel: "linkedin",
  capabilities: gatedCaps,
  verifyWebhook(): WebhookVerification {
    return { kind: "rejected", status: 404, reason: "linkedin_private_messaging_is_partner_gated" };
  },
  parseInboundEvents(): ParsedInboundEvent[] {
    return [];
  },
  normalizeInboundMessage(): CanonicalInboundMessage | null {
    return null;
  },
  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    throw new ConnectorCapabilityError(
      "LinkedIn private messaging requires approved partner access. Community comments are not inbox DMs.",
      "PARTNER_GATED",
    );
  },
  async reconcileMessage(): Promise<SendMessageResult> {
    throw new ConnectorCapabilityError("LinkedIn private messaging is partner-gated", "PARTNER_GATED");
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
        channel: "linkedin",
        implemented: false,
        credentialsReady: false,
        partnerGated: true,
      }),
      missing: ["Approved LinkedIn partner private-messaging access"],
      credentialConfigured: false,
    });
  },
};
