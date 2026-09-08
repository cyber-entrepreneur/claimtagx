export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://claimtagx.com";
export const SITE_NAME = "ClaimTagX";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/opengraph.jpg`;
export const TWITTER_HANDLE = "@Claimtagx";

export const SUPPORTED_LOCALES = ["en", "ar"] as const;

export function absoluteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL.replace(/\/$/, "")}${normalized}`;
}

export function localizedAbsoluteUrl(path: string, locale: "en" | "ar"): string {
  if (locale === "en") return absoluteUrl(path);
  const normalized = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return absoluteUrl(`/ar${normalized}`);
}
