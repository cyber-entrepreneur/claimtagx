import type { Request, Response } from "express";
import { connectorMetrics } from "./metrics";
import type { ChannelAdapter } from "./types";
import { headerValue } from "./types";
import { META_WEBHOOK_MAX_BYTES } from "./metaSignature";

export const CONNECTOR_WEBHOOK_MAX_BYTES = META_WEBHOOK_MAX_BYTES;

function jsonContentType(headers: Record<string, string | string[] | undefined>): boolean {
  const ct = (headerValue(headers, "content-type") ?? "").toLowerCase();
  return ct.includes("application/json");
}

export async function handleConnectorWebhook(
  req: Request,
  res: Response,
  adapter: ChannelAdapter,
): Promise<void> {
  const rawBytes = (req as Request & { rawBodyBytes?: Buffer }).rawBodyBytes;
  const rawBody =
    (req as Request & { rawBody?: string }).rawBody ??
    (rawBytes ? rawBytes.toString("utf8") : JSON.stringify(req.body ?? {}));
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = v;

  if (req.method === "POST") {
    const size = rawBytes?.length ?? Buffer.byteLength(rawBody);
    if (size > CONNECTOR_WEBHOOK_MAX_BYTES) {
      connectorMetrics.webhookRejected += 1;
      res.status(413).json({ error: "payload_too_large", live: false });
      return;
    }
    if (!jsonContentType(headers)) {
      connectorMetrics.webhookRejected += 1;
      res.status(415).json({ error: "unsupported_content_type", live: false });
      return;
    }
  }

  const verification = adapter.verifyWebhook({
    nodeEnv: process.env.NODE_ENV,
    rawBody,
    rawBodyBytes: rawBytes,
    headers,
    query: req.query as Record<string, unknown>,
    body: req.body,
  });
  if (verification.kind === "challenge") {
    res.status(verification.status).type(verification.contentType).send(verification.body);
    return;
  }
  if (verification.kind === "rejected") {
    connectorMetrics.webhookRejected += 1;
    if (
      verification.reason.includes("not_configured") ||
      verification.reason.includes("signature") ||
      verification.reason === "bad_signature" ||
      verification.reason === "missing_signature"
    ) {
      connectorMetrics.authFailures += 1;
    }
    res.status(verification.status).json({ error: verification.reason, live: false });
    return;
  }
  connectorMetrics.webhookAccepted += 1;
  res.status(202).json({ accepted: true, channel: adapter.channel, live: false });
  void import("./inbound").then(({ ingestConnectorEvents }) =>
    ingestConnectorEvents({
      adapter,
      rawBody,
      body: req.body,
      correlationId: typeof req.headers["x-correlation-id"] === "string" ? req.headers["x-correlation-id"] : undefined,
    }),
  ).catch(() => {
    connectorMetrics.inboundFailed += 1;
  });
}
