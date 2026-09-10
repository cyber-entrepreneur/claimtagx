import { timingSafeEqual } from "node:crypto";

export {
  MICROSOFT_GRAPH_WEBHOOK_CONTRACT,
  graphNotificationAuthorized,
  graphNotificationEventId,
  parseGraphNotifications,
  respondGraphValidationToken,
  verifyGraphClientState,
} from "./microsoftGraph/webhookSecurity";

/** Shared-secret guard for local fixture webhooks only. */
export function inboundWebhookAuthorized(params: {
  nodeEnv: string | undefined;
  secret: string | undefined;
  provided: string | string[] | undefined;
}): { ok: boolean; status?: number } {
  const secret = params.secret?.trim();
  if (!secret) {
    if (params.nodeEnv === "production") return { ok: false, status: 401 };
    return { ok: true };
  }
  const header = Array.isArray(params.provided) ? params.provided[0] : params.provided;
  if (!header) return { ok: false, status: 401 };
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return { ok: false, status: 401 };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401 };
}
