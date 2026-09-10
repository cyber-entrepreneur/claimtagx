export const CHANNEL_STATUSES = [
  "LIVE_VERIFIED",
  "IMPLEMENTED_AWAITING_CREDENTIALS",
  "BLOCKED_APP_REVIEW",
  "PARTNER_GATED",
  "UNSUPPORTED_BY_PUBLIC_API",
  "DISABLED",
  "ERROR",
] as const;

export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const INBOX_CHANNELS = [
  "website",
  "microsoft365",
  "whatsapp",
  "messenger",
  "instagram",
  "x",
  "tiktok",
  "linkedin",
] as const;

export type InboxChannel = (typeof INBOX_CHANNELS)[number];

export const MESSAGE_DELIVERY_STATUSES = [
  "received",
  "queued",
  "sending",
  "accepted",
  "delivered",
  "read",
  "failed",
  "uncertain",
] as const;

export type MessageDeliveryStatus = (typeof MESSAGE_DELIVERY_STATUSES)[number];

export type ChannelCapabilities = {
  inbound: boolean;
  outbound: boolean;
  attachments: boolean;
  templates: boolean;
  readReceipts: boolean;
  deliveryReceipts: boolean;
  reconciliation: boolean;
  replyWindowHours: number | null;
  webhooks: boolean;
  polling: boolean;
  maxMessageBytes: number;
  allowedAttachmentTypes: string[];
  manualHandoff: boolean;
};

export type WebhookVerification =
  | { kind: "challenge"; status: number; body: string; contentType: string }
  | { kind: "accepted" }
  | { kind: "rejected"; status: number; reason: string };

export type ParsedInboundEvent = {
  providerEventId: string;
  kind: "message" | "delivery" | "read" | "unknown";
  raw: unknown;
};

export type CanonicalParty = {
  providerUserId?: string;
  email?: string;
  phone?: string;
  handle?: string;
  displayName?: string;
};

export type CanonicalInboundMessage = {
  channel: InboxChannel;
  providerAccountId: string;
  providerMessageId: string;
  providerReplyToId?: string;
  externalThreadId: string;
  providerUserId: string;
  direction: "inbound" | "outbound";
  bodyText: string;
  bodyHtml?: string;
  subject?: string;
  sender: CanonicalParty;
  recipients: CanonicalParty[];
  attachments: Array<{ name: string; mimeType: string; sizeBytes?: number; providerRef?: string }>;
  providerTimestamp?: Date;
  idempotencyKey: string;
  allowlistedMetadata: Record<string, unknown>;
  verifiedEmail?: string;
  verifiedPhone?: string;
};

export type SendMessageInput = {
  channelAccountId: string;
  conversationExternalId?: string;
  toProviderUserId?: string;
  toEmail?: string;
  toPhone?: string;
  text: string;
  html?: string;
  subject?: string;
  replyToProviderMessageId?: string;
  templateName?: string;
  templateLanguage?: string;
  idempotencyKey: string;
};

export type SendMessageResult = {
  accepted: boolean;
  uncertain?: boolean;
  providerMessageId?: string;
  providerRequestId?: string;
  retryable?: boolean;
  failureClass?: string;
  error?: string;
};

export type DeliveryMapping = {
  providerMessageId: string;
  status: MessageDeliveryStatus;
  failureClass?: string;
  providerAccountId?: string;
};

export type HealthCheckResult = {
  ok: boolean;
  status: ChannelStatus;
  live: boolean;
  simulator: boolean;
  missingRequirements: string[];
  credentialConfigured: boolean;
  lastError?: string;
};

export type ChannelAdapterContext = {
  nodeEnv: string | undefined;
  rawBody: string;
  rawBodyBytes?: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
};

export interface ChannelAdapter {
  channel: InboxChannel;
  capabilities(): ChannelCapabilities;
  verifyWebhook(ctx: ChannelAdapterContext): WebhookVerification;
  parseInboundEvents(body: unknown): ParsedInboundEvent[];
  normalizeInboundMessage(event: ParsedInboundEvent): CanonicalInboundMessage | null;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  reconcileMessage(providerMessageId: string): Promise<SendMessageResult>;
  mapDeliveryStatus(payload: unknown): DeliveryMapping | null;
  downloadAttachment(ref: string): Promise<{ bytes: Uint8Array; mimeType: string; filename: string } | null>;
  refreshCredentials(): Promise<{ refreshed: boolean; error?: string }>;
  healthCheck(): HealthCheckResult;
}

export class ConnectorCapabilityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = "ConnectorCapabilityError";
  }
}

export function emptyCapabilities(overrides: Partial<ChannelCapabilities> = {}): ChannelCapabilities {
  return {
    inbound: false,
    outbound: false,
    attachments: false,
    templates: false,
    readReceipts: false,
    deliveryReceipts: false,
    reconciliation: false,
    replyWindowHours: null,
    webhooks: false,
    polling: false,
    maxMessageBytes: 0,
    allowedAttachmentTypes: [],
    manualHandoff: false,
    ...overrides,
  };
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const found = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase());
  if (!found) return undefined;
  const v = found[1];
  return Array.isArray(v) ? v[0] : v;
}
