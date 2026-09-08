import { logger } from "../../logger";

export type GraphErrorClass = "transient" | "permanent" | "throttle" | "auth";

export function classifyGraphHttpStatus(status: number): GraphErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "throttle";
  if (status === 408 || status === 409 || status >= 500) return "transient";
  if (status === 404) return "permanent";
  return "permanent";
}

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

export function assertSafeGraphUrl(input: string, label = "url"): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw Object.assign(new Error(`${label} is not a valid URL`), { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    throw Object.assign(new Error(`${label} must use https`), { status: 400 });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error(`${label} must not include credentials`), { status: 400 });
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = new Set([
    "graph.microsoft.com",
    "login.microsoftonline.com",
  ]);
  const allowExtra =
    process.env.NODE_ENV === "production"
      ? []
      : (process.env.MS_GRAPH_ALLOWED_HOSTS ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
  for (const h of allowExtra) allowed.add(h);
  if (!allowed.has(host) && !host.endsWith(".graph.microsoft.com")) {
    throw Object.assign(new Error(`${label} host is not an allowed Microsoft Graph endpoint`), {
      status: 400,
    });
  }
  return parsed;
}

export async function graphFetch(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<Response> {
  assertSafeGraphUrl(input, "graphFetch");
  const maxAttempts = opts?.maxAttempts ?? 4;
  const baseDelayMs = opts?.baseDelayMs ?? 250;
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetchImpl(input, init);
    if (res.ok || res.status === 404) return res;
    const kind = classifyGraphHttpStatus(res.status);
    if (kind === "permanent" || kind === "auth" || attempt >= maxAttempts) return res;
    const retryAfter = kind === "throttle" ? parseRetryAfterMs(res.headers.get("Retry-After")) : null;
    const delay = retryAfter ?? baseDelayMs * 2 ** (attempt - 1);
    logger.warn({ url: input, status: res.status, attempt, delay, kind }, "graph fetch retry scheduled");
    await new Promise((r) => setTimeout(r, delay));
  }
}
