import { readFileSync } from "node:fs";

export type GraphCredential =
  | { kind: "secret"; clientSecret: string }
  | { kind: "certificate"; thumbprint: string; privateKeyPem: string };

export type MicrosoftGraphConfig = {
  tenantId: string;
  clientId: string;
  credential: GraphCredential;
  mailboxUpn: string;
  notificationUrl: string;
  clientState: string;
  deltaEncryptionKey: Buffer;
};

export type MicrosoftGraphConfigIssue = {
  field: string;
  message: string;
};

export const MICROSOFT_GRAPH_PERMISSIONS = [
  {
    permission: "Mail.Send",
    type: "Application",
    reason: "Send transactional and acknowledgment mail from the configured Exchange Online mailbox.",
  },
  {
    permission: "Mail.Read",
    type: "Application",
    reason: "Read inbound replies and delta-sync messages from the configured mailbox.",
  },
  {
    permission: "Mail.ReadWrite",
    type: "Application",
    reason: "Optional: mark processed messages and manage read state during reconciliation.",
  },
] as const;

export const MICROSOFT_GRAPH_ADMIN_CONSENT = [
  "Register an Entra ID application (single tenant recommended).",
  "Add application permissions Mail.Send and Mail.Read (Mail.ReadWrite optional).",
  "Grant admin consent for the tenant.",
  "Create an Exchange Online application access policy scoped to MS_GRAPH_MAILBOX_UPN.",
  "Configure MS_GRAPH_NOTIFICATION_URL as a publicly reachable HTTPS endpoint.",
] as const;

function readSecret(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function decodeKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, raw.length === 64 && /^[0-9a-f]+$/i.test(raw) ? "hex" : "base64");
    return buf.length >= 32 ? buf.subarray(0, 32) : null;
  } catch {
    return null;
  }
}

function readPem(name: string, pathName: string): string | undefined {
  const inline = readSecret(name);
  if (inline) {
    if (inline.includes("BEGIN")) return inline.replace(/\\n/g, "\n");
    return Buffer.from(inline, "base64").toString("utf8");
  }
  const path = readSecret(pathName);
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function loadCredential(): GraphCredential | null {
  const secret = readSecret("MS_GRAPH_CLIENT_SECRET");
  const thumbprint = readSecret("MS_GRAPH_CLIENT_CERTIFICATE_THUMBPRINT");
  const privateKeyPem = readPem("MS_GRAPH_CLIENT_CERTIFICATE", "MS_GRAPH_CLIENT_CERTIFICATE_PATH");
  if (secret) return { kind: "secret", clientSecret: secret };
  if (thumbprint && privateKeyPem) return { kind: "certificate", thumbprint, privateKeyPem };
  return null;
}

export function loadMicrosoftGraphConfig(): MicrosoftGraphConfig | null {
  const tenantId = readSecret("MS_GRAPH_TENANT_ID");
  const clientId = readSecret("MS_GRAPH_CLIENT_ID");
  const credential = loadCredential();
  const mailboxUpn = readSecret("MS_GRAPH_MAILBOX_UPN");
  const notificationUrl = readSecret("MS_GRAPH_NOTIFICATION_URL");
  const clientState = readSecret("MS_GRAPH_CLIENT_STATE");
  const deltaEncryptionKey = decodeKey(readSecret("MS_GRAPH_DELTA_ENCRYPTION_KEY"));
  if (!tenantId || !clientId || !credential || !mailboxUpn || !notificationUrl || !clientState || !deltaEncryptionKey) {
    return null;
  }
  return {
    tenantId,
    clientId,
    credential,
    mailboxUpn,
    notificationUrl,
    clientState,
    deltaEncryptionKey,
  };
}

function validateNotificationUrl(raw: string, nodeEnv = process.env.NODE_ENV): MicrosoftGraphConfigIssue | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { field: "MS_GRAPH_NOTIFICATION_URL", message: "must be a valid URL" };
  }
  if (nodeEnv === "production" && parsed.protocol !== "https:") {
    return { field: "MS_GRAPH_NOTIFICATION_URL", message: "must be https in production" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { field: "MS_GRAPH_NOTIFICATION_URL", message: "must be http(s)" };
  }
  if (parsed.username || parsed.password) {
    return { field: "MS_GRAPH_NOTIFICATION_URL", message: "must not include credentials" };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    if (nodeEnv === "production") {
      return { field: "MS_GRAPH_NOTIFICATION_URL", message: "loopback hosts are not allowed in production" };
    }
  }
  // Block obvious link-local / metadata targets that would enable SSRF via webhook callbacks.
  if (
    /^(10\.|192\.168\.|169\.254\.|0\.0\.0\.0$)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return { field: "MS_GRAPH_NOTIFICATION_URL", message: "private/link-local hosts are not allowed" };
  }
  return null;
}

export function validateMicrosoftGraphConfig(
  nodeEnv = process.env.NODE_ENV,
): { ok: true; config: MicrosoftGraphConfig } | { ok: false; issues: MicrosoftGraphConfigIssue[] } {
  const issues: MicrosoftGraphConfigIssue[] = [];
  if (!readSecret("MS_GRAPH_TENANT_ID")) issues.push({ field: "MS_GRAPH_TENANT_ID", message: "required" });
  if (!readSecret("MS_GRAPH_CLIENT_ID")) issues.push({ field: "MS_GRAPH_CLIENT_ID", message: "required" });
  const secret = readSecret("MS_GRAPH_CLIENT_SECRET");
  const thumbprint = readSecret("MS_GRAPH_CLIENT_CERTIFICATE_THUMBPRINT");
  const pem = readPem("MS_GRAPH_CLIENT_CERTIFICATE", "MS_GRAPH_CLIENT_CERTIFICATE_PATH");
  if (!secret && !(thumbprint && pem)) {
    issues.push({
      field: "MS_GRAPH_CLIENT_SECRET",
      message: "MS_GRAPH_CLIENT_SECRET or certificate credential pair is required",
    });
  }
  if (!readSecret("MS_GRAPH_MAILBOX_UPN")) issues.push({ field: "MS_GRAPH_MAILBOX_UPN", message: "required" });
  const notificationUrl = readSecret("MS_GRAPH_NOTIFICATION_URL");
  if (!notificationUrl) {
    issues.push({ field: "MS_GRAPH_NOTIFICATION_URL", message: "required" });
  } else {
    const urlIssue = validateNotificationUrl(notificationUrl, nodeEnv);
    if (urlIssue) issues.push(urlIssue);
  }
  if (!readSecret("MS_GRAPH_CLIENT_STATE")) issues.push({ field: "MS_GRAPH_CLIENT_STATE", message: "required" });
  if (!decodeKey(readSecret("MS_GRAPH_DELTA_ENCRYPTION_KEY"))) {
    issues.push({
      field: "MS_GRAPH_DELTA_ENCRYPTION_KEY",
      message: "required 32-byte key (base64 or 64-char hex)",
    });
  }
  if (issues.length) return { ok: false, issues };
  const config = loadMicrosoftGraphConfig();
  if (!config) {
    return { ok: false, issues: [{ field: "MS_GRAPH", message: "configuration incomplete" }] };
  }
  return { ok: true, config };
}

export function graphProductionRequired(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

export function graphSimulatorEnabled(): boolean {
  return (
    process.env.CRM_GRAPH_SIMULATOR === "true" ||
    process.env.CRM_EMAIL_SIMULATOR === "true" ||
    process.env.CRM_ALLOW_TEST_JOBS === "true"
  );
}

export function getFromAddress(): string {
  const explicit = process.env.EMAIL_FROM?.trim();
  if (explicit) return explicit;
  const mailbox = readSecret("MS_GRAPH_MAILBOX_UPN");
  if (mailbox) return `ClaimTagX <${mailbox}>`;
  return "ClaimTagX <noreply@claimtagx.com>";
}

export function extractMailDomain(fromAddress = getFromAddress()): string {
  const match = fromAddress.match(/@([A-Za-z0-9.-]+)/);
  return (match?.[1] ?? "claimtagx.com").toLowerCase();
}
