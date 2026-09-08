import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelStatus, HealthCheckResult, InboxChannel } from "./types";

const TERMINAL_DECLARED: ChannelStatus[] = [
  "DISABLED",
  "UNSUPPORTED_BY_PUBLIC_API",
  "PARTNER_GATED",
  "BLOCKED_APP_REVIEW",
  "ERROR",
];

export function secretPresent(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[name]?.trim());
}

export function channelSimulatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CRM_CHANNEL_SIMULATOR === "true" || env.CRM_ALLOW_TEST_JOBS === "true";
}

export function firstPartyEvidenceBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    channelSimulatorEnabled(env) ||
    env.CRM_EMAIL_SIMULATOR === "true" ||
    env.CRM_GRAPH_SIMULATOR === "true"
  );
}

export function assertChannelSimulatorForbidden(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && env.CRM_CHANNEL_SIMULATOR === "true") {
    throw new Error("CRM_CHANNEL_SIMULATOR is forbidden in production");
  }
}

export function resolveDeclaredStatus(params: {
  channel: InboxChannel;
  implemented: boolean;
  credentialsReady: boolean;
  appReviewPending?: boolean;
  partnerGated?: boolean;
  unsupported?: boolean;
  disabled?: boolean;
  error?: boolean;
  env?: NodeJS.ProcessEnv;
}): ChannelStatus {
  const env = params.env ?? process.env;
  if (params.disabled || env[`CRM_CHANNEL_${params.channel.toUpperCase()}_DISABLED`] === "true") {
    return "DISABLED";
  }
  if (params.unsupported) return "UNSUPPORTED_BY_PUBLIC_API";
  if (params.partnerGated) return "PARTNER_GATED";
  if (params.appReviewPending || env[`CRM_CHANNEL_${params.channel.toUpperCase()}_APP_REVIEW`] === "true") {
    return "BLOCKED_APP_REVIEW";
  }
  if (params.error) return "ERROR";
  if (params.implemented) return "IMPLEMENTED_AWAITING_CREDENTIALS";
  return "DISABLED";
}

export function composeChannelStatus(params: {
  declared: ChannelStatus;
  liveVerifiedAt: Date | null | undefined;
  credentialConfigured?: boolean;
}): ChannelStatus {
  if (TERMINAL_DECLARED.includes(params.declared)) return params.declared;
  if (params.liveVerifiedAt && params.credentialConfigured !== false) return "LIVE_VERIFIED";
  return params.declared;
}

export function healthFromStatus(params: {
  status: ChannelStatus;
  missing: string[];
  credentialConfigured: boolean;
  lastError?: string;
}): HealthCheckResult {
  return {
    ok: params.status !== "DISABLED" && params.status !== "UNSUPPORTED_BY_PUBLIC_API" && params.status !== "ERROR",
    status: params.status,
    live: false,
    simulator: false,
    missingRequirements: params.missing,
    credentialConfigured: params.credentialConfigured,
    lastError: params.lastError,
  };
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function timingSafeHexEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function redactProviderError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]")
    .replace(/app.?secret[=:]\s*\S+/gi, "app_secret=[redacted]");
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
