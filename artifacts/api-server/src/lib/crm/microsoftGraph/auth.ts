import { createHash, createSign, randomUUID } from "node:crypto";
import { logger } from "../../logger";
import type { GraphCredential, MicrosoftGraphConfig } from "./config";

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

const tokenCache = new Map<string, CachedToken>();

export function resetGraphTokenCache(): void {
  tokenCache.clear();
}

export function graphTokenCacheKey(config: Pick<MicrosoftGraphConfig, "tenantId" | "clientId">): string {
  return `${config.tenantId}:${config.clientId}`;
}

function base64Url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildClientAssertion(config: MicrosoftGraphConfig, credential: Extract<GraphCredential, { kind: "certificate" }>): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", x5t: base64Url(Buffer.from(credential.thumbprint, "hex")) }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    JSON.stringify({
      aud: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      exp: now + 600,
      iss: config.clientId,
      jti: randomUUID(),
      nbf: now,
      sub: config.clientId,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64Url(signer.sign(credential.privateKeyPem));
  return `${unsigned}.${signature}`;
}

function tokenRequestBody(config: MicrosoftGraphConfig): URLSearchParams {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  if (config.credential.kind === "secret") {
    body.set("client_secret", config.credential.clientSecret);
  } else {
    body.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    body.set("client_assertion", buildClientAssertion(config, config.credential));
  }
  return body;
}

export async function acquireGraphAccessToken(
  config: MicrosoftGraphConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const cacheKey = graphTokenCacheKey(config);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.accessToken;
  }
  const url = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenRequestBody(config),
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const reason = json.error_description ?? json.error ?? `token HTTP ${res.status}`;
    logger.error({ status: res.status, error: json.error }, "Microsoft Graph token acquisition failed");
    throw Object.assign(new Error(`Microsoft Graph token acquisition failed: ${reason}`), { status: 503 });
  }
  const expiresIn = Number(json.expires_in ?? 3600);
  tokenCache.set(cacheKey, {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + Math.max(60, expiresIn - 120) * 1000,
  });
  return json.access_token;
}

export function hashClientState(clientState: string): string {
  return createHash("sha256").update(clientState).digest("hex");
}

export function buildClientAssertionForTest(config: MicrosoftGraphConfig): string | null {
  if (config.credential.kind !== "certificate") return null;
  return buildClientAssertion(config, config.credential);
}
