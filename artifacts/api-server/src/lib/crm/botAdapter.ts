import { createHash } from "node:crypto";

export type BotAdapterKind = "unset" | "simulator" | "honeypot_only" | "turnstile";
export type BotDecision = "accepted" | "challenged" | "rejected" | "failed" | "unavailable";

export type BotProtectionPublicConfig = {
  provider: BotAdapterKind;
  siteKey: string;
  scriptSrc: string;
  action: string;
  fallback: "email";
  proofRequired: boolean;
};

export type BotVerifyInput = {
  honeypot?: string;
  botProof?: string | null;
  ip?: string;
  hostname?: string;
  action?: string;
};

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const CLOUDFLARE_DUMMY_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);
const CLOUDFLARE_DUMMY_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
]);

const metrics: Record<BotDecision, number> = {
  accepted: 0,
  challenged: 0,
  rejected: 0,
  failed: 0,
  unavailable: 0,
};

let testFetch: typeof fetch | null = null;
const memoryReplay = new Set<string>();

export function resetBotMetrics(): void {
  for (const k of Object.keys(metrics) as BotDecision[]) metrics[k] = 0;
  memoryReplay.clear();
}

export function botMetrics(): Record<BotDecision, number> {
  return { ...metrics };
}

export function setTurnstileFetchForTests(fn: typeof fetch | null): void {
  testFetch = fn;
}

function record(decision: BotDecision): BotDecision {
  metrics[decision] += 1;
  return decision;
}

function deny(message: string, status: number, decision: BotDecision): never {
  record(decision);
  throw Object.assign(new Error(message), { status, botDecision: decision });
}

export function botAdapterKind(env: NodeJS.ProcessEnv = process.env): BotAdapterKind {
  const raw = (env.CRM_BOT_ADAPTER ?? "").trim().toLowerCase();
  if (!raw) return "unset";
  if (raw === "honeypot_only" || raw === "honeypot") return "honeypot_only";
  if (raw === "simulator" || raw === "test") return "simulator";
  if (raw === "turnstile" || raw === "cloudflare_turnstile") return "turnstile";
  return "unset";
}

export function publicBotProtectionConfig(env: NodeJS.ProcessEnv = process.env): BotProtectionPublicConfig {
  const kind = botAdapterKind(env);
  const siteKey = (env.CRM_TURNSTILE_SITE_KEY ?? "").trim();
  const action = (env.CRM_TURNSTILE_EXPECTED_ACTION ?? "contact_submit").trim() || "contact_submit";
  return {
    provider: kind,
    siteKey: kind === "turnstile" ? siteKey : "",
    scriptSrc: "https://challenges.cloudflare.com/turnstile/v0/api.js",
    action,
    fallback: "email",
    proofRequired: kind === "turnstile",
  };
}

export function assertBotAdapterProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const kind = botAdapterKind(env);
  if (kind === "simulator") {
    throw new Error("CRM_BOT_ADAPTER=simulator is forbidden in production");
  }
  if (kind === "honeypot_only") {
    throw new Error("CRM_BOT_ADAPTER=honeypot_only is forbidden as the production configuration");
  }
  if (kind !== "turnstile") {
    throw new Error("CRM_BOT_ADAPTER must be turnstile in production");
  }
  const secret = (env.CRM_TURNSTILE_SECRET_KEY ?? "").trim();
  const siteKey = (env.CRM_TURNSTILE_SITE_KEY ?? "").trim();
  const hosts = (env.CRM_TURNSTILE_EXPECTED_HOSTNAMES ?? "").trim();
  if (!secret) throw new Error("CRM_TURNSTILE_SECRET_KEY is required in production");
  if (!siteKey) throw new Error("CRM_TURNSTILE_SITE_KEY is required in production");
  if (!hosts) throw new Error("CRM_TURNSTILE_EXPECTED_HOSTNAMES is required in production");
  if (CLOUDFLARE_DUMMY_SECRETS.has(secret) || CLOUDFLARE_DUMMY_SITE_KEYS.has(siteKey)) {
    throw new Error("Cloudflare Turnstile dummy/test keys are forbidden in production");
  }
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function rememberProof(token: string, env: NodeJS.ProcessEnv): Promise<void> {
  const fp = tokenFingerprint(token);
  const useMemory = env.CRM_BOT_REPLAY_STORE === "memory" || !env.DATABASE_URL;
  if (useMemory) {
    if (memoryReplay.has(fp)) deny("Unable to submit right now.", 400, "rejected");
    memoryReplay.add(fp);
    return;
  }
  const { rateLimitOk } = await import("./rateLimit");
  const ok = await rateLimitOk(`botproof:${fp}`, 1, 30 * 60_000);
  if (!ok) deny("Unable to submit right now.", 400, "rejected");
}

type TurnstileSiteverify = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
  cdata?: string;
};

async function verifyTurnstile(
  input: BotVerifyInput,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const token = (input.botProof ?? "").trim();
  if (!token) deny("Complete the security check and try again.", 400, "challenged");
  const timeoutMs = Number(env.CRM_TURNSTILE_TIMEOUT_MS ?? "2500");
  const secret = (env.CRM_TURNSTILE_SECRET_KEY ?? "").trim();
  if (!secret) deny("Unable to submit right now.", 503, "unavailable");
  const expectedHosts = (env.CRM_TURNSTILE_EXPECTED_HOSTNAMES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const expectedAction = (env.CRM_TURNSTILE_EXPECTED_ACTION ?? "contact_submit").trim();
  const body = new URLSearchParams({ secret, response: token });
  if (env.CRM_TURNSTILE_SEND_REMOTE_IP === "true" && input.ip) {
    body.set("remoteip", input.ip);
  }
  const fetchImpl = testFetch ?? fetch;
  let res: Response;
  let json: TurnstileSiteverify;
  try {
    res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 2500),
      redirect: "error",
    });
  } catch {
    deny("Unable to submit right now.", 503, "unavailable");
  }
  if (res.status < 200 || res.status > 299) {
    deny("Unable to submit right now.", res.status >= 500 ? 503 : 400, res.status >= 500 ? "unavailable" : "failed");
  }
  try {
    json = (await res.json()) as TurnstileSiteverify;
  } catch {
    deny("Unable to submit right now.", 503, "unavailable");
  }
  if (!json || typeof json !== "object" || json.success !== true) {
    const codes = json && typeof json === "object" ? (json["error-codes"] ?? []) : [];
    if (Array.isArray(codes) && codes.includes("timeout-or-duplicate")) deny("Unable to submit right now.", 400, "rejected");
    deny("Complete the security check and try again.", 400, "rejected");
  }
  const hostname = typeof json.hostname === "string" ? json.hostname.trim().toLowerCase() : "";
  const action = typeof json.action === "string" ? json.action.trim() : "";
  if (!hostname || !action) {
    deny("Unable to submit right now.", 400, "rejected");
  }
  if (!expectedHosts.length || !expectedAction) {
    deny("Unable to submit right now.", 503, "unavailable");
  }
  if (!expectedHosts.includes(hostname)) {
    deny("Unable to submit right now.", 400, "rejected");
  }
  if (action !== expectedAction) {
    deny("Unable to submit right now.", 400, "rejected");
  }
  await rememberProof(token, env);
  record("accepted");
}

/**
 * Layered bot gate. Honeypot is a cheap first signal, not a production control.
 * Remote-IP: optional (`CRM_TURNSTILE_SEND_REMOTE_IP=true`). Cloudflare documents
 * remoteip as optional; omitting it still verifies the token.
 * Proof tokens are never logged. Replay uses a SHA-256 fingerprint in rate-limit storage.
 */
export async function verifyBotProof(
  input: BotVerifyInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BotDecision> {
  if (input.honeypot) deny("Unable to submit right now.", 400, "rejected");
  const kind = botAdapterKind(env);
  if (env.NODE_ENV === "production") {
    assertBotAdapterProduction(env);
  }
  if (kind === "simulator") {
    if (env.NODE_ENV === "production") deny("Unable to submit right now.", 503, "unavailable");
    const token = (input.botProof ?? "").trim();
    if (!token.startsWith("sim:")) deny("Complete the security check and try again.", 400, "challenged");
    await rememberProof(token, env);
    return record("accepted");
  }
  if (kind === "turnstile") {
    await verifyTurnstile(input, env);
    return "accepted";
  }
  if (kind === "honeypot_only" && env.NODE_ENV === "production") {
    deny("Unable to submit right now.", 503, "unavailable");
  }
  if (input.botProof && (kind === "unset" || kind === "honeypot_only")) {
    deny("Unable to submit right now.", 400, "rejected");
  }
  return record("accepted");
}
