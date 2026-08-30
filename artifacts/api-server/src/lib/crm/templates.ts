export interface MergeVars {
  [key: string]: string | number | null | undefined | MergeVars;
}

function lookup(vars: MergeVars, path: string): string {
  const parts = path.split(".");
  let current: unknown = vars;
  for (const part of parts) {
    if (!current || typeof current !== "object") return "";
    current = (current as MergeVars)[part];
  }
  if (current == null) return "";
  if (typeof current === "object") return "";
  return String(current);
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function renderTemplate(
  template: string,
  vars: MergeVars,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(VAR_RE, (_, path: string) => {
    const value = lookup(vars, path);
    if (value === "") missing.push(path);
    return value;
  });
  return { text, missing };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\n|\r/g, "<br/>");
}
