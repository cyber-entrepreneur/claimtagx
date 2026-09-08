import { loadMicrosoftGraphConfig, getFromAddress, extractMailDomain, graphSimulatorEnabled } from "./microsoftGraph/config";
import { sendMailViaGraph, type GraphSendArgs, type GraphSendResult } from "./microsoftGraph/client";
import { normalizeMessageId } from "./emailThreading";

export type ThreadingEmailHeaders = {
  messageId?: string;
  inReplyTo?: string;
  references?: string;
};

export type ProviderSendArgs = GraphSendArgs;
export type ProviderSendResult = GraphSendResult;

export interface EmailProvider {
  send(args: ProviderSendArgs): Promise<ProviderSendResult>;
}

export { getFromAddress, extractMailDomain };

export function toRfc822Headers(
  headers?: ThreadingEmailHeaders,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const mapped: Record<string, string> = {};
  if (headers.messageId) mapped["Message-ID"] = normalizeMessageId(headers.messageId);
  if (headers.inReplyTo) mapped["In-Reply-To"] = normalizeMessageId(headers.inReplyTo);
  if (headers.references?.trim()) mapped["References"] = headers.references.trim();
  return Object.keys(mapped).length ? mapped : undefined;
}

export function createMicrosoftGraphEmailProvider(): EmailProvider {
  return {
    async send(args) {
      const config = loadMicrosoftGraphConfig();
      if (!config) {
        if (graphSimulatorEnabled()) {
          const { simulatedGraphSend } = await import("./microsoftGraph/simulator");
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
        if (process.env.NODE_ENV === "production") {
          throw new Error("Microsoft Graph email configuration is required in production");
        }
        throw new Error("Microsoft Graph email configuration is missing");
      }
      return sendMailViaGraph(config, args);
    },
  };
}

export function getEmailProvider(): EmailProvider {
  return createMicrosoftGraphEmailProvider();
}
