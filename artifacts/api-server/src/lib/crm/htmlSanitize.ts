import sanitizeHtmlLib from "sanitize-html";

const OPTIONS = {
  allowedTags: ["a", "p", "br", "strong", "em", "ul", "ol", "li", "span", "div"],
  allowedAttributes: {
    a: ["href", "rel", "target"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard" as const,
  transformTags: {
    a: sanitizeHtmlLib.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

/** DOM-aware sanitizer (sanitize-html). Regex-only stripping is not used. */
export function sanitizeHtml(html: string, maxLength = 100_000): string {
  return sanitizeHtmlLib(html.slice(0, maxLength), OPTIONS);
}

export function htmlToPlainText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
  return sanitizeHtmlLib(withBreaks, { allowedTags: [], allowedAttributes: {} }).trim();
}
