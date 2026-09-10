import { extractHeader, type GraphMessage } from "./client";

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function graphMessageToInboundPayload(message: GraphMessage) {
  const from = message.from?.emailAddress?.address;
  if (!from) return null;
  const html = message.body?.contentType?.toLowerCase() === "html" ? message.body.content ?? "" : undefined;
  const text =
    message.body?.contentType?.toLowerCase() === "text"
      ? message.body.content ?? message.bodyPreview ?? ""
      : message.bodyPreview ?? (html ? htmlToText(html) : "");
  if (!text.trim()) return null;
  return {
    from,
    subject: message.subject,
    text,
    html,
    messageId: message.internetMessageId ?? extractHeader(message, "Message-ID"),
    inReplyTo: extractHeader(message, "In-Reply-To"),
    references: extractHeader(message, "References"),
  };
}
