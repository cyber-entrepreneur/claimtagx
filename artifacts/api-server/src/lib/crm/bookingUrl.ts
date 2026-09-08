/**
 * Governed meeting booking URLs. Production hosts default to Calendly only.
 * Extra hosts: CRM_BOOKING_ALLOWED_HOSTS (comma-separated, no wildcards except subdomain of an allowed registrable host).
 */
export function parseGovernedBookingUrl(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const extra =
    env.NODE_ENV === "production"
      ? []
      : (env.CRM_BOOKING_ALLOWED_HOSTS ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
  const allowed = new Set(["calendly.com", ...extra]);
  const host = url.hostname.toLowerCase();
  const ok = [...allowed].some((a) => host === a || (a.includes(".") && host.endsWith(`.${a}`)) || host.endsWith(`.${a}`));
  if (!ok) return null;
  return url;
}

export function bookingUrlForAudit(url: URL): string {
  return `${url.origin}${url.pathname}`;
}
