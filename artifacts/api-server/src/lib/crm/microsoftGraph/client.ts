import { logger } from "../../logger";
import { acquireGraphAccessToken } from "./auth";
import type { MicrosoftGraphConfig } from "./config";
import { graphSimulatorEnabled } from "./config";
import { graphFetch } from "./http";
import { simulatedGraphSend, reconcileSimulatedGraphSend, simulateCreateSubscription, simulateRenewSubscription } from "./simulator";

export type ThreadingEmailHeaders = {
  messageId?: string;
  inReplyTo?: string;
  references?: string;
};

export type GraphSendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  headers?: ThreadingEmailHeaders;
  idempotencyKey?: string;
};

export type GraphSendResult = {
  providerMessageId: string | null;
  providerRequestId: string | null;
  internetMessageId: string | null;
};

function toInternetHeaders(headers?: ThreadingEmailHeaders): Array<{ name: string; value: string }> {
  if (!headers) return [];
  const out: Array<{ name: string; value: string }> = [];
  if (headers.messageId) out.push({ name: "Message-ID", value: headers.messageId });
  if (headers.inReplyTo) out.push({ name: "In-Reply-To", value: headers.inReplyTo });
  if (headers.references?.trim()) out.push({ name: "References", value: headers.references.trim() });
  return out;
}

export async function sendMailViaGraph(
  config: MicrosoftGraphConfig,
  args: GraphSendArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<GraphSendResult> {
  if (graphSimulatorEnabled()) {
    const sim = await simulatedGraphSend({
      idempotencyKey: args.idempotencyKey ?? `no-key:${args.to}:${args.subject}`,
      to: args.to,
      subject: args.subject,
    });
    return {
      providerMessageId: sim.providerMessageId,
      providerRequestId: sim.providerRequestId,
      internetMessageId: sim.internetMessageId,
    };
  }
  const token = await acquireGraphAccessToken(config, fetchImpl);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailboxUpn)}/sendMail`;
  const internetHeaders = toInternetHeaders(args.headers);
  const res = await graphFetch(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(args.idempotencyKey ? { "client-request-id": args.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        message: {
          subject: args.subject,
          body: { contentType: "HTML", content: args.html },
          toRecipients: [{ emailAddress: { address: args.to } }],
          ...(internetHeaders.length ? { internetMessageHeaders: internetHeaders } : {}),
        },
        saveToSentItems: true,
      }),
    },
    fetchImpl,
  );
  if (res.status === 202 || res.status === 200) {
    const requestId = res.headers.get("request-id");
    const providerMessageId = requestId ?? args.idempotencyKey ?? null;
    logger.info(
      {
        recipientDomain: args.to.split("@")[1] ?? "",
        subject: args.subject,
        providerRequestId: requestId,
      },
      "Microsoft Graph accepted outbound mail",
    );
    return {
      providerMessageId,
      providerRequestId: requestId,
      internetMessageId: args.headers?.messageId ?? null,
    };
  }
  const errBody = await res.text();
  logger.error({ status: res.status, body: errBody.slice(0, 500) }, "Microsoft Graph rejected outbound mail");
  throw Object.assign(new Error(`Microsoft Graph sendMail failed (${res.status})`), { status: res.status });
}

export async function reconcileGraphSend(keyOrRequest: string): Promise<GraphSendResult | null> {
  const found = reconcileSimulatedGraphSend(keyOrRequest);
  if (!found) return null;
  return {
    providerMessageId: found.providerMessageId,
    providerRequestId: found.providerRequestId,
    internetMessageId: found.internetMessageId,
  };
}

export type GraphMessage = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string } };
  internetMessageId?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
};

export async function fetchGraphMessage(
  config: MicrosoftGraphConfig,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GraphMessage | null> {
  if (graphSimulatorEnabled()) return null;
  const token = await acquireGraphAccessToken(config, fetchImpl);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailboxUpn)}/messages/${encodeURIComponent(messageId)}?$select=id,subject,bodyPreview,body,from,internetMessageId,internetMessageHeaders`;
  const res = await graphFetch(url, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Graph message fetch failed (${res.status})`), { detail: text.slice(0, 300) });
  }
  return (await res.json()) as GraphMessage;
}

export function extractHeader(message: GraphMessage, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const header of message.internetMessageHeaders ?? []) {
    if ((header.name ?? "").toLowerCase() === target) return header.value ?? undefined;
  }
  return undefined;
}

export type GraphDeltaPage = {
  messages: GraphMessage[];
  deltaLink?: string;
  nextLink?: string;
};

export async function fetchGraphDeltaPage(
  config: MicrosoftGraphConfig,
  link: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GraphDeltaPage> {
  if (graphSimulatorEnabled()) return { messages: [] };
  const token = await acquireGraphAccessToken(config, fetchImpl);
  const res = await graphFetch(link, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Graph delta fetch failed (${res.status})`), { detail: text.slice(0, 300) });
  }
  const json = (await res.json()) as {
    value?: GraphMessage[];
    "@odata.deltaLink"?: string;
    "@odata.nextLink"?: string;
  };
  return {
    messages: json.value ?? [],
    deltaLink: json["@odata.deltaLink"],
    nextLink: json["@odata.nextLink"],
  };
}

export function initialGraphDeltaUrl(config: MicrosoftGraphConfig): string {
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailboxUpn)}/mailFolders/inbox/messages/delta?$select=id,subject,bodyPreview,body,from,internetMessageId,internetMessageHeaders`;
}

export type GraphSubscription = {
  id: string;
  expirationDateTime: string;
};

export async function createGraphMailSubscription(
  config: MicrosoftGraphConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GraphSubscription> {
  if (graphSimulatorEnabled()) {
    return simulateCreateSubscription(config.mailboxUpn);
  }
  const token = await acquireGraphAccessToken(config, fetchImpl);
  const expiration = new Date(Date.now() + 3_600_000 * 48).toISOString();
  const res = await graphFetch("https://graph.microsoft.com/v1.0/subscriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: config.notificationUrl,
      resource: `/users/${config.mailboxUpn}/mailFolders('Inbox')/messages`,
      expirationDateTime: expiration,
      clientState: config.clientState,
      includeResourceData: false,
    }),
  }, fetchImpl);
  const json = (await res.json()) as GraphSubscription & { error?: { message?: string } };
  if (!res.ok) {
    throw Object.assign(new Error(json.error?.message ?? `subscription create failed (${res.status})`), {
      status: res.status,
    });
  }
  return json;
}

export async function renewGraphSubscription(
  config: MicrosoftGraphConfig,
  subscriptionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GraphSubscription> {
  if (graphSimulatorEnabled()) {
    const renewed = simulateRenewSubscription(subscriptionId);
    if (renewed.collision) {
      throw Object.assign(new Error("subscription renewal collision"), { status: 409, collision: true });
    }
    return { id: renewed.id, expirationDateTime: renewed.expirationDateTime };
  }
  const token = await acquireGraphAccessToken(config, fetchImpl);
  const expiration = new Date(Date.now() + 3_600_000 * 48).toISOString();
  const res = await graphFetch(
    `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expirationDateTime: expiration }),
    },
    fetchImpl,
  );
  const json = (await res.json()) as GraphSubscription & { error?: { message?: string } };
  if (!res.ok) {
    throw Object.assign(new Error(json.error?.message ?? `subscription renew failed (${res.status})`), {
      status: res.status,
    });
  }
  return json;
}
