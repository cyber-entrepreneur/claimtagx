import { createHash, randomUUID } from "node:crypto";

export type SimulatedOutcome =
  | "accepted"
  | "duplicate"
  | "timeout_before_accept"
  | "timeout_after_accept"
  | "reset"
  | "4xx"
  | "401"
  | "403"
  | "404"
  | "409"
  | "429"
  | "5xx";

export type SimulatedSend = {
  idempotencyKey: string;
  providerRequestId: string;
  providerMessageId: string | null;
  status: "accepted" | "unknown" | "rejected";
  sends: number;
  delivered?: boolean;
  bounced?: boolean;
  complained?: boolean;
};

const byKey = new Map<string, SimulatedSend>();
const byRequest = new Map<string, SimulatedSend>();

export const simulatedProviderConfig = {
  nextOutcome: "accepted" as SimulatedOutcome,
};

export function resetEmailSimulator() {
  byKey.clear();
  byRequest.clear();
  simulatedProviderConfig.nextOutcome = "accepted";
}

export async function simulatedProviderSend(opts: {
  idempotencyKey: string;
  to: string;
  subject: string;
}): Promise<{ providerMessageId: string; providerRequestId: string }> {
  void opts.to;
  void opts.subject;
  const existing = byKey.get(opts.idempotencyKey);
  const outcome = simulatedProviderConfig.nextOutcome;
  if (existing) {
    existing.sends += 1;
    if (existing.providerMessageId) {
      return { providerMessageId: existing.providerMessageId, providerRequestId: existing.providerRequestId };
    }
  }
  const providerRequestId = existing?.providerRequestId ?? `req_${randomUUID()}`;
  if (outcome === "timeout_before_accept" || outcome === "reset") {
    const row: SimulatedSend = {
      idempotencyKey: opts.idempotencyKey,
      providerRequestId,
      providerMessageId: null,
      status: "unknown",
      sends: (existing?.sends ?? 0) + 1,
    };
    byKey.set(opts.idempotencyKey, row);
    byRequest.set(providerRequestId, row);
    throw new Error(outcome === "reset" ? "ECONNRESET" : "provider timeout before acceptance");
  }
  if (outcome === "401") throw Object.assign(new Error("provider 401"), { status: 401 });
  if (outcome === "403") throw Object.assign(new Error("provider 403"), { status: 403 });
  if (outcome === "404") throw Object.assign(new Error("provider 404"), { status: 404 });
  if (outcome === "409") throw Object.assign(new Error("provider 409"), { status: 409 });
  if (outcome === "4xx") throw Object.assign(new Error("provider 400"), { status: 400 });
  if (outcome === "429") throw Object.assign(new Error("provider 429"), { status: 429 });
  if (outcome === "5xx") throw Object.assign(new Error("provider 500"), { status: 500 });

  const providerMessageId = existing?.providerMessageId ?? `sim_${createHash("sha256").update(opts.idempotencyKey).digest("hex").slice(0, 16)}`;
  const row: SimulatedSend = {
    idempotencyKey: opts.idempotencyKey,
    providerRequestId,
    providerMessageId,
    status: "accepted",
    sends: (existing?.sends ?? 0) + 1,
  };
  byKey.set(opts.idempotencyKey, row);
  byRequest.set(providerRequestId, row);
  if (outcome === "timeout_after_accept") {
    throw new Error("provider timeout after acceptance");
  }
  return { providerMessageId, providerRequestId };
}

export function reconcileSimulatedSend(keyOrRequest: string): SimulatedSend | null {
  return byKey.get(keyOrRequest) ?? byRequest.get(keyOrRequest) ?? null;
}

export function markSimulatedDelivery(idempotencyKey: string, kind: "delivered" | "bounce" | "complaint") {
  const row = byKey.get(idempotencyKey);
  if (!row) return null;
  if (kind === "delivered") row.delivered = true;
  if (kind === "bounce") row.bounced = true;
  if (kind === "complaint") row.complained = true;
  return row;
}

export function simulatedSendCount(idempotencyKey: string): number {
  return byKey.get(idempotencyKey)?.sends ?? 0;
}
