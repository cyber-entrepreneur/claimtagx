import { logger } from "../../logger";
import { processInboundEmail } from "../inboundEmail";
import { enqueueJob } from "../queue";
import {
  createGraphMailSubscription,
  fetchGraphDeltaPage,
  fetchGraphMessage,
  initialGraphDeltaUrl,
  renewGraphSubscription,
} from "./client";
import type { MicrosoftGraphConfig } from "./config";
import { graphMessageToInboundPayload } from "./messageParser";
export { graphMessageToInboundPayload } from "./messageParser";
import {
  readDeltaLink,
  saveSubscriptionState,
  subscriptionNeedsRenewal,
  touchMailboxNotification,
  writeDeltaLink,
} from "./mailboxState";
import {
  graphNotificationEventId,
  type GraphChangeNotification,
} from "./webhookSecurity";

export async function processGraphChangeNotifications(
  config: MicrosoftGraphConfig,
  notifications: GraphChangeNotification[],
) {
  await touchMailboxNotification(config);
  for (const notification of notifications) {
    const messageId = notification.resourceData?.id;
    if (!messageId) {
      await enqueueJob("graph_mail_delta_sync", { reason: "missing_resource_data" });
      continue;
    }
    const message = await fetchGraphMessage(config, messageId);
    if (!message) continue;
    const payload = graphMessageToInboundPayload(message);
    if (!payload) continue;
    const providerEventId = graphNotificationEventId(notification);
    await processInboundEmail({
      providerEventId,
      rawBody: JSON.stringify({ notification, messageId }),
      payload,
      headers: {},
    });
  }
}

export async function runGraphDeltaSync(config: MicrosoftGraphConfig): Promise<{ processed: number }> {
  let link = (await readDeltaLink(config)) ?? initialGraphDeltaUrl(config);
  let processed = 0;
  while (link) {
    const page = await fetchGraphDeltaPage(config, link);
    for (const message of page.messages) {
      const payload = graphMessageToInboundPayload(message);
      if (!payload) continue;
      const providerEventId = `graph-delta:${message.id}`;
      await processInboundEmail({
        providerEventId,
        rawBody: JSON.stringify({ messageId: message.id, source: "delta" }),
        payload,
        headers: {},
      });
      processed += 1;
    }
    if (page.nextLink) {
      link = page.nextLink;
      continue;
    }
    if (page.deltaLink) await writeDeltaLink(config, page.deltaLink);
    break;
  }
  logger.info({ processed, mailbox: config.mailboxUpn }, "graph delta sync completed");
  return { processed };
}

export async function ensureGraphMailSubscription(config: MicrosoftGraphConfig): Promise<void> {
  if (await subscriptionNeedsRenewal(config)) {
    const row = await import("./mailboxState").then((m) => m.loadMailboxState(config.mailboxUpn));
    if (row?.subscriptionId) {
      const renewed = await renewGraphSubscription(config, row.subscriptionId);
      await saveSubscriptionState(config, renewed);
      return;
    }
    const created = await createGraphMailSubscription(config);
    await saveSubscriptionState(config, created);
  }
}
