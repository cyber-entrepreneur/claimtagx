import { createHmac, timingSafeEqual } from "node:crypto";
import { headerValue } from "./types";

export const META_WEBHOOK_MAX_BYTES = 64 * 1024;

export function verifyMetaSha256Signature(params: {
  rawBody: string | Buffer;
  header: string | undefined;
  appSecret: string;
}): boolean {
  if (!params.header || !params.appSecret) return false;
  const payload = typeof params.rawBody === "string" ? Buffer.from(params.rawBody, "utf8") : params.rawBody;
  const expected = `sha256=${createHmac("sha256", params.appSecret).update(payload).digest("hex")}`;
  const a = Buffer.from(params.header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function metaVerifyChallenge(query: Record<string, unknown>, verifyToken: string): string | null {
  const mode = String(query["hub.mode"] ?? query.hub_mode ?? "");
  const token = String(query["hub.verify_token"] ?? query.hub_verify_token ?? "");
  const challenge = String(query["hub.challenge"] ?? query.hub_challenge ?? "");
  if (mode === "subscribe" && token && verifyToken && token === verifyToken && challenge) return challenge;
  return null;
}

export function metaSignatureFrom(ctx: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  return headerValue(ctx.headers, "x-hub-signature-256");
}

export function verifyXTwitterWebhookSignature(params: {
  rawBody: string | Buffer;
  header: string | undefined;
  consumerSecret: string;
}): boolean {
  if (!params.header || !params.consumerSecret) return false;
  const payload = typeof params.rawBody === "string" ? Buffer.from(params.rawBody, "utf8") : params.rawBody;
  const digest = createHmac("sha256", params.consumerSecret).update(payload).digest("base64");
  const expected = `sha256=${digest}`;
  const provided = params.header.trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
