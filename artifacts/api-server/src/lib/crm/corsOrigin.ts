/**
 * Credentialed CORS / CSRF origin policy.
 * Production: exact configured origins only.
 * Non-production: configured origins plus parsed loopback http(s) hosts.
 */
export type OriginEnv = {
  NODE_ENV?: string;
  CORS_ALLOWED_ORIGINS?: string;
  REPLIT_DEV_DOMAIN?: string;
  REPLIT_DEPLOYMENT_DOMAIN?: string;
};

function addConfigured(list: Set<string>, raw: string | undefined): void {
  if (!raw) return;
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v) continue;
    list.add(v.startsWith("http") ? v : `https://${v}`);
  }
}

export function configuredCorsOrigins(env: OriginEnv = process.env): Set<string> {
  const list = new Set<string>();
  addConfigured(list, env.REPLIT_DEV_DOMAIN);
  addConfigured(list, env.REPLIT_DEPLOYMENT_DOMAIN);
  addConfigured(list, env.CORS_ALLOWED_ORIGINS);
  if (env.NODE_ENV !== "production") {
    list.add("http://localhost:5173");
    list.add("http://localhost:8080");
    list.add("http://127.0.0.1:5173");
    list.add("http://127.0.0.1:8080");
  }
  return list;
}

/** Parse an Origin header. Rejects userinfo, paths, queries, hashes, and non-http(s). */
export function parseBrowserOrigin(origin: string): URL | null {
  if (typeof origin !== "string") return null;
  const trimmed = origin.trim();
  if (!trimmed || trimmed !== origin) return null;
  if (trimmed.length > 253) return null;
  if (/[\s\\]/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.origin !== trimmed) return null;
  return url;
}

function isIntendedLoopbackOrigin(url: URL): boolean {
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
  if (url.port === "") return false;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return true;
}

/**
 * Whether a browser Origin may be reflected for credentialed CORS / cookie CSRF.
 * Missing origin is not allowed here; callers treat empty origin separately.
 */
export function isCredentialedOriginAllowed(
  origin: string | undefined | null,
  env: OriginEnv = process.env,
): boolean {
  if (!origin) return false;
  const parsed = parseBrowserOrigin(origin);
  if (!parsed) return false;
  if (configuredCorsOrigins(env).has(parsed.origin)) return true;
  if (env.NODE_ENV === "production") return false;
  return isIntendedLoopbackOrigin(parsed);
}

export function corsOriginDelegate(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
  env: OriginEnv = process.env,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }
  if (isCredentialedOriginAllowed(origin, env)) {
    callback(null, true);
    return;
  }
  callback(null, false);
}
