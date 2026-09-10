const BANNED_BOOKING_QUERY = new Set([
  "email",
  "name",
  "first_name",
  "last_name",
  "full_name",
  "phone",
  "a2",
  "a3",
]);

/** Browser-side booking CTA allowlist. Live Calendly remains the default governed host. */
export function isSafePublicBookingUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host !== "calendly.com" && !host.endsWith(".calendly.com")) return false;
    for (const key of url.searchParams.keys()) {
      if (BANNED_BOOKING_QUERY.has(key.toLowerCase())) return false;
    }
    return true;
  } catch {
    return false;
  }
}
