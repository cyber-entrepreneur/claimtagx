import { randomUUID } from "node:crypto";

export const INQUIRY_REFERENCE_RE = /CTX-\d{4}-\d{6}/i;
export const DEFAULT_WEBHOOK_REPLAY_WINDOW_MS = 5 * 60_000;
export const DEFAULT_MAIL_DOMAIN = "claimtagx.com";

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const MESSAGE_ID_TOKEN_RE = /<[^>]+>/g;

export type ThreadParent = {
  messageId?: string | null;
  referencesHeader?: string | null;
};

export type ThreadingHeaders = {
  messageId: string;
  inReplyTo?: string;
  references?: string;
};

export type ParsedInboundHeaders = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  referencesHeader: string | null;
};

export type ConversationAssociation = {
  reference: string | null;
  parentMessageId: string | null;
  referenceSource: "subject" | "none";
};

export type WebhookTimestampResult = {
  ok: boolean;
  reason?: "invalid_timestamp" | "replay_window";
  ageMs?: number;
};

export type WebhookEventStore = {
  claim(providerEventId: string): boolean | Promise<boolean>;
};

export type WebhookIdempotencyResult = {
  duplicate: boolean;
  eventId: string;
};

/** Normalize an RFC Message-ID to a single `<local@domain>` token. */
export function normalizeMessageId(value: string): string {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/<[^<>]+>/);
  const raw = (bracketed?.[0] ?? trimmed).replace(/^<|>$/g, "").trim();
  if (!raw) return "";
  return `<${raw}>`;
}

export function generateMessageId(domain: string): string {
  const host = domain.replace(/^<+|>+$/g, "").replace(/^@/, "").trim().toLowerCase();
  if (!DOMAIN_RE.test(host)) {
    throw new Error("Invalid Message-ID domain");
  }
  return `<${randomUUID()}@${host}>`;
}

export function parseReferencesHeader(value?: string | null): string[] {
  if (!value?.trim()) return [];
  const tokens = value.match(MESSAGE_ID_TOKEN_RE);
  if (tokens?.length) {
    return uniqueIds(tokens.map((t) => normalizeMessageId(t)));
  }
  return uniqueIds(
    value
      .split(/\s+/)
      .map((part) => normalizeMessageId(part))
      .filter(Boolean),
  );
}

export function buildThreadingHeaders(
  parent?: ThreadParent | null,
  domain = DEFAULT_MAIL_DOMAIN,
): ThreadingHeaders {
  const messageId = generateMessageId(domain);
  const parentId = parent?.messageId ? normalizeMessageId(parent.messageId) : "";
  if (!parentId || !parent) {
    return { messageId };
  }
  const ancestors = parseReferencesHeader(parent.referencesHeader);
  const references = uniqueIds([...ancestors, parentId]).join(" ");
  return {
    messageId,
    inReplyTo: parentId,
    references,
  };
}

export function parseInboundHeaders(input: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  headers?: Record<string, string | string[] | undefined>;
}): ParsedInboundHeaders {
  const headerMap = lowercaseHeaderMap(input.headers);
  const messageId = firstId(
    input.messageId ?? headerValue(headerMap, "message-id"),
  );
  const inReplyTo = firstId(
    input.inReplyTo ?? headerValue(headerMap, "in-reply-to"),
  );
  const referencesRaw =
    input.references ?? headerValue(headerMap, "references") ?? null;
  const references = parseReferencesHeader(referencesRaw);
  return {
    messageId,
    inReplyTo,
    references,
    referencesHeader: references.length ? references.join(" ") : null,
  };
}

/**
 * Correlate an inbound message to an inquiry conversation.
 * Prefers `CTX-YYYY-NNNNNN` in the subject; also returns In-Reply-To / References
 * so the caller can look up the parent `crm_messages.message_id`.
 */
export function associateToConversation(input: {
  subject?: string | null;
  inReplyTo?: string | null;
  references?: string[] | string | null;
}): ConversationAssociation {
  const fromSubject = input.subject?.match(INQUIRY_REFERENCE_RE)?.[0]?.toUpperCase() ?? null;
  const parentMessageId =
    firstId(input.inReplyTo) ?? firstReference(input.references);
  return {
    reference: fromSubject,
    parentMessageId,
    referenceSource: fromSubject ? "subject" : "none",
  };
}

export function verifyWebhookTimestamp(
  timestamp: string | number | Date,
  now: number | Date = Date.now(),
  windowMs = DEFAULT_WEBHOOK_REPLAY_WINDOW_MS,
): WebhookTimestampResult {
  const ts = parseTimestampMs(timestamp);
  if (ts === null) return { ok: false, reason: "invalid_timestamp" };
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "invalid_timestamp" };
  const ageMs = Math.abs(nowMs - ts);
  if (ageMs > windowMs) return { ok: false, reason: "replay_window", ageMs };
  return { ok: true, ageMs };
}

export function createMemoryWebhookEventStore(): WebhookEventStore & {
  size(): number;
  clear(): void;
  has(id: string): boolean;
} {
  const seen = new Set<string>();
  return {
    claim(providerEventId: string) {
      if (seen.has(providerEventId)) return false;
      seen.add(providerEventId);
      return true;
    },
    size: () => seen.size,
    clear: () => seen.clear(),
    has: (id: string) => seen.has(id),
  };
}

/**
 * Claim a provider webhook event id. Returns `{ duplicate: true }` when the
 * store has already seen it. Production callers should pass a store backed by
 * the unique `crm_messages.provider_event_id` constraint.
 */
export async function idempotentWebhookEvent(
  providerEventId: string,
  store: WebhookEventStore,
): Promise<WebhookIdempotencyResult> {
  const eventId = providerEventId.trim();
  if (!eventId) throw new Error("providerEventId is required");
  const claimed = await store.claim(eventId);
  return { duplicate: !claimed, eventId };
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const normalized = normalizeMessageId(id);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function firstId(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const normalized = normalizeMessageId(value);
  return normalized || null;
}

function firstReference(value?: string[] | string | null): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    return parseReferencesHeader(value)[0] ?? firstId(value);
  }
  for (const item of value) {
    const id = firstId(item);
    if (id) return id;
  }
  return null;
}

function lowercaseHeaderMap(
  headers?: Record<string, string | string[] | undefined>,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!headers) return map;
  for (const [key, raw] of Object.entries(headers)) {
    if (raw == null) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string" || !value) continue;
    map.set(key.toLowerCase(), value);
  }
  return map;
}

function headerValue(map: Map<string, string>, name: string): string | undefined {
  return map.get(name);
}

function parseTimestampMs(value: string | number | Date): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 1e12 ? Math.round(value * 1000) : value;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return n < 1e12 ? Math.round(n * 1000) : n;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
