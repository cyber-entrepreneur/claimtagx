import { localizedAbsoluteUrl } from "./siteConfig";

export const LEGAL_PATHS = [
  "/privacy",
  "/terms",
  "/refund",
  "/cookies",
  "/gdpr",
  "/dpa",
  "/aup",
] as const;

export function isLegalPath(path: string): boolean {
  const normalized = path.split("?")[0]?.replace(/\/$/, "") || "/";
  return (LEGAL_PATHS as readonly string[]).includes(normalized);
}

export function hreflangAlternatesForPath(path: string): Array<{ hrefLang: string; href: string }> {
  const en = { hrefLang: "en", href: localizedAbsoluteUrl(path, "en") };
  const xDefault = { hrefLang: "x-default", href: localizedAbsoluteUrl(path, "en") };
  if (isLegalPath(path)) {
    return [en, xDefault];
  }
  return [en, { hrefLang: "ar", href: localizedAbsoluteUrl(path, "ar") }, xDefault];
}

export function legalPageSeo(
  path: string,
  locale: "en" | "ar",
  copy: { title: string; description: string },
): {
  title: string;
  description: string;
  path: string;
  url: string;
  noindex: boolean;
  robots: string;
} {
  const arabicIncomplete = isLegalPath(path) && locale === "ar";
  return {
    title: copy.title,
    description: copy.description,
    path,
    url: localizedAbsoluteUrl(path, arabicIncomplete ? "en" : locale),
    noindex: arabicIncomplete,
    robots: arabicIncomplete ? "noindex, nofollow" : "index, follow",
  };
}
