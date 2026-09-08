import { createHash } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import type { MicrosoftGraphConfig } from "./config";

export const MICROSOFT_GRAPH_WEBHOOK_CONTRACT = {
  provider: "Microsoft Graph",
  transport: "Change notifications",
  docs: "https://learn.microsoft.com/en-us/graph/webhooks",
  validationQueryParam: "validationToken",
  clientStateHeader: "clientState",
} as const;

export function respondGraphValidationToken(validationToken: string): { status: number; body: string; contentType: string } {
  return { status: 200, body: validationToken, contentType: "text/plain; charset=utf-8" };
}

export function verifyGraphClientState(
  provided: string | undefined,
  expected: string,
): { ok: boolean; reason?: string } {
  if (!provided?.trim()) return { ok: false, reason: "missing_client_state" };
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return { ok: false, reason: "bad_client_state" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "bad_client_state" };
}

export type GraphChangeNotification = {
  subscriptionId: string;
  clientState: string;
  changeType: string;
  resource: string;
  resourceData?: { id?: string; "@odata.type"?: string };
};

export function parseGraphNotifications(body: unknown): GraphChangeNotification[] {
  if (!body || typeof body !== "object") return [];
  const value = (body as { value?: unknown }).value;
  if (!Array.isArray(value)) return [];
  const out: GraphChangeNotification[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const subscriptionId = String(row.subscriptionId ?? "");
    const clientState = String(row.clientState ?? "");
    const changeType = String(row.changeType ?? "");
    const resource = String(row.resource ?? "");
    if (!subscriptionId || !resource) continue;
    const resourceData =
      row.resourceData && typeof row.resourceData === "object"
        ? (row.resourceData as GraphChangeNotification["resourceData"])
        : undefined;
    out.push({ subscriptionId, clientState, changeType, resource, resourceData });
  }
  return out;
}

export function graphNotificationEventId(notification: GraphChangeNotification): string {
  const messageId = notification.resourceData?.id ?? "";
  return createHash("sha256")
    .update(`${notification.subscriptionId}:${notification.changeType}:${notification.resource}:${messageId}`)
    .digest("hex");
}

export function graphNotificationAuthorized(
  config: MicrosoftGraphConfig,
  notifications: GraphChangeNotification[],
): { ok: boolean; reason?: string } {
  if (notifications.length === 0) return { ok: false, reason: "empty_batch" };
  for (const notification of notifications) {
    const check = verifyGraphClientState(notification.clientState, config.clientState);
    if (!check.ok) return check;
  }
  return { ok: true };
}
