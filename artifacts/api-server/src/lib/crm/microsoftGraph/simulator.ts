import { createHash, randomUUID } from "node:crypto";
import { simulatedProviderConfig, type SimulatedOutcome } from "../emailSimulator";

export type SimulatedGraphSend = {
  idempotencyKey: string;
  providerRequestId: string;
  providerMessageId: string | null;
  internetMessageId: string | null;
  status: "accepted" | "unknown" | "rejected";
  sends: number;
};

export type GraphSimOutcome =
  | SimulatedOutcome
  | "401"
  | "403"
  | "404"
  | "409"
  | "token_timeout"
  | "429_seconds"
  | "429_http_date";

const byKey = new Map<string, SimulatedGraphSend>();
const byRequest = new Map<string, SimulatedGraphSend>();
const notifications = new Map<string, { id: string; seen: number }>();
const subscriptions = new Map<string, { id: string; expiresAt: number; renewals: number }>();

export const graphSimulatorState = {
  nextOutcome: "accepted" as GraphSimOutcome,
  nextRetryAfter: null as string | null,
  invalidDeltaTokens: new Set<string>(),
  missedNotificationIds: new Set<string>(),
  subscriptionRenewCollision: false,
};

export function resetGraphSimulator() {
  byKey.clear();
  byRequest.clear();
  notifications.clear();
  subscriptions.clear();
  simulatedProviderConfig.nextOutcome = "accepted";
  graphSimulatorState.nextOutcome = "accepted";
  graphSimulatorState.nextRetryAfter = null;
  graphSimulatorState.invalidDeltaTokens.clear();
  graphSimulatorState.missedNotificationIds.clear();
  graphSimulatorState.subscriptionRenewCollision = false;
}

function statusError(status: number, message: string, retryAfter?: string | null): never {
  const err = Object.assign(new Error(message), { status }) as Error & {
    status: number;
    headers?: Record<string, string>;
  };
  if (retryAfter) err.headers = { "Retry-After": retryAfter };
  throw err;
}

export async function simulatedGraphSend(opts: {
  idempotencyKey: string;
  to: string;
  subject: string;
}): Promise<{ providerMessageId: string; providerRequestId: string; internetMessageId: string }> {
  void opts.to;
  void opts.subject;
  const outcome = graphSimulatorState.nextOutcome;
  const existing = byKey.get(opts.idempotencyKey);
  const providerRequestId = existing?.providerRequestId ?? `graph_req_${randomUUID()}`;
  if (existing?.providerMessageId) {
    existing.sends += 1;
    return {
      providerMessageId: existing.providerMessageId,
      providerRequestId,
      internetMessageId: existing.internetMessageId ?? `<${existing.providerMessageId}@sim.local>`,
    };
  }
  if (outcome === "token_timeout") {
    throw Object.assign(new Error("graph token acquisition timeout"), { code: "ETIMEDOUT", status: 504 });
  }
  if (outcome === "timeout_before_accept" || outcome === "reset") {
    const row: SimulatedGraphSend = {
      idempotencyKey: opts.idempotencyKey,
      providerRequestId,
      providerMessageId: null,
      internetMessageId: null,
      status: "unknown",
      sends: (existing?.sends ?? 0) + 1,
    };
    byKey.set(opts.idempotencyKey, row);
    byRequest.set(providerRequestId, row);
    throw new Error(outcome === "reset" ? "ECONNRESET" : "provider timeout before acceptance");
  }
  if (outcome === "401") statusError(401, "provider 401");
  if (outcome === "403") statusError(403, "provider 403");
  if (outcome === "404") statusError(404, "provider 404");
  if (outcome === "409") statusError(409, "provider 409");
  if (outcome === "4xx") statusError(400, "provider 400");
  if (outcome === "429" || outcome === "429_seconds") {
    statusError(429, "provider 429", graphSimulatorState.nextRetryAfter ?? "2");
  }
  if (outcome === "429_http_date") {
    const hdr = graphSimulatorState.nextRetryAfter ?? new Date(Date.now() + 2000).toUTCString();
    statusError(429, "provider 429", hdr);
  }
  if (outcome === "5xx") statusError(500, "provider 500");

  const providerMessageId =
    existing?.providerMessageId ??
    `graph_${createHash("sha256").update(opts.idempotencyKey).digest("hex").slice(0, 16)}`;
  const internetMessageId = `<${providerMessageId}@sim.local>`;
  const row: SimulatedGraphSend = {
    idempotencyKey: opts.idempotencyKey,
    providerRequestId,
    providerMessageId,
    internetMessageId,
    status: "accepted",
    sends: (existing?.sends ?? 0) + 1,
  };
  byKey.set(opts.idempotencyKey, row);
  byRequest.set(providerRequestId, row);
  if (outcome === "timeout_after_accept") {
    throw new Error("provider timeout after acceptance");
  }
  return { providerMessageId, providerRequestId, internetMessageId };
}

export function reconcileSimulatedGraphSend(keyOrRequest: string): SimulatedGraphSend | null {
  return byKey.get(keyOrRequest) ?? byRequest.get(keyOrRequest) ?? null;
}

export function simulatedGraphSendCount(idempotencyKey: string): number {
  return byKey.get(idempotencyKey)?.sends ?? 0;
}

/** Dedup notification delivery; missed ids never appear until explicitly unmissed. */
export function simulateGraphNotification(eventId: string): { accepted: boolean; duplicate: boolean; missed: boolean } {
  if (graphSimulatorState.missedNotificationIds.has(eventId)) {
    return { accepted: false, duplicate: false, missed: true };
  }
  const existing = notifications.get(eventId);
  if (existing) {
    existing.seen += 1;
    return { accepted: false, duplicate: true, missed: false };
  }
  notifications.set(eventId, { id: eventId, seen: 1 });
  return { accepted: true, duplicate: false, missed: false };
}

export function unmissGraphNotification(eventId: string): void {
  graphSimulatorState.missedNotificationIds.delete(eventId);
}

export function simulateDeltaFetch(token: string): { ok: boolean; reason?: string } {
  if (graphSimulatorState.invalidDeltaTokens.has(token) || token === "invalid") {
    return { ok: false, reason: "invalid_delta_token" };
  }
  return { ok: true };
}

export function simulateCreateSubscription(mailbox: string): { id: string; expirationDateTime: string } {
  const id = `sim_sub_${mailbox}_${Date.now()}`;
  const expiresAt = Date.now() + 3_600_000;
  subscriptions.set(id, { id, expiresAt, renewals: 0 });
  return { id, expirationDateTime: new Date(expiresAt).toISOString() };
}

export function simulateRenewSubscription(subscriptionId: string): {
  id: string;
  expirationDateTime: string;
  collision: boolean;
} {
  const row = subscriptions.get(subscriptionId);
  if (!row) {
    statusError(404, "subscription not found");
  }
  if (row.expiresAt < Date.now()) {
    statusError(404, "subscription expired");
  }
  if (graphSimulatorState.subscriptionRenewCollision) {
    row.renewals += 1;
    return {
      id: subscriptionId,
      expirationDateTime: new Date(row.expiresAt).toISOString(),
      collision: true,
    };
  }
  row.expiresAt = Date.now() + 3_600_000 * 48;
  row.renewals += 1;
  return {
    id: subscriptionId,
    expirationDateTime: new Date(row.expiresAt).toISOString(),
    collision: false,
  };
}

export function expireSimulatedSubscription(subscriptionId: string): void {
  const row = subscriptions.get(subscriptionId);
  if (row) row.expiresAt = Date.now() - 1;
}

export function getSimulatedSubscription(subscriptionId: string) {
  return subscriptions.get(subscriptionId) ?? null;
}
