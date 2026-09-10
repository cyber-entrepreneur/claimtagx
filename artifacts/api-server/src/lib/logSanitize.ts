const DENY_KEYS = new Set([
  "email",
  "emailnormalized",
  "phone",
  "phonee164",
  "phoneraw",
  "phonenationalnumber",
  "accesskey",
  "clientsecret",
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "password",
  "bodyhtml",
  "textbody",
  "sanitizedhtml",
  "rawpayload",
  "contentbase64",
  "bytesbase64",
  "package",
]);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+[1-9]\d{6,14}\b|\b\d{10,15}\b)/;
const BODY_KEYS = new Set(["req.body", "body", "contact", "dsar", "attachments"]);

function keyDenied(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (DENY_KEYS.has(k)) return true;
  if (k.includes("email") || k.includes("phone") || k.includes("token") || k.includes("secret")) return true;
  if (k.includes("attachment") && (k.includes("meta") || k.includes("filename") || k.includes("storage"))) return true;
  return false;
}

function redactString(value: string): string {
  return value.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]");
}

/** Recursively redact PII from structured logs. Arrays and nested objects included. */
export function sanitizeLogValue(value: unknown, depth = 0, keyHint = ""): unknown {
  if (depth > 10) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, depth + 1, keyHint));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keyDenied(k) || BODY_KEYS.has(`${keyHint}.${k}`) || k === "body" || k === "package") {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeLogValue(v, depth + 1, k);
    }
    return out;
  }
  return String(value);
}

export function sanitizeLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  return sanitizeLogValue(record) as Record<string, unknown>;
}
