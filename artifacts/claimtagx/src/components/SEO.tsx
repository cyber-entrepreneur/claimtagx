import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_OG_IMAGE, SITE_NAME, TWITTER_HANDLE } from "@/lib/seo/siteConfig";
import { hreflangAlternatesForPath } from "@/lib/seo/legalLocalization";

type JsonLd = Record<string, unknown> | Array<Record<string, unknown>>;

interface SEOProps {
  title: string;
  description: string;
  image?: string;
  url?: string;
  path?: string;
  robots?: string;
  jsonLd?: JsonLd;
  noindex?: boolean;
}

function upsertLink(rel: string, href: string, hreflang?: string) {
  const selector = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"]`
    : `link[rel="${rel}"]:not([hreflang])`;
  let element = document.head.querySelector(selector) as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement("link");
    element.rel = rel;
    if (hreflang) element.hreflang = hreflang;
    document.head.appendChild(element);
  }
  element.href = href;
}

function upsertMeta(name: string, content: string, property?: string) {
  const selector = property ? `meta[property="${property}"]` : `meta[name="${name}"]`;
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    if (name) element.name = name;
    if (property) element.setAttribute("property", property);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function upsertJsonLd(id: string, payload: JsonLd) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const script = document.createElement("script");
  script.id = id;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(payload);
  document.head.appendChild(script);
}

export default function SEO({
  title,
  description,
  image = DEFAULT_OG_IMAGE,
  url,
  path = "/",
  robots = "index, follow",
  jsonLd,
  noindex = false,
}: SEOProps) {
  const { locale } = useI18n();
  const canonical = url ?? undefined;

  useEffect(() => {
    document.title = title;
    upsertMeta("description", description);
    upsertMeta("", title, "og:title");
    upsertMeta("", description, "og:description");
    upsertMeta("", image, "og:image");
    upsertMeta("", canonical ?? window.location.href, "og:url");
    upsertMeta("", "website", "og:type");
    upsertMeta("", SITE_NAME, "og:site_name");
    upsertMeta("", locale === "ar" ? "ar" : "en_US", "og:locale");
    upsertMeta("twitter:card", "summary_large_image");
    upsertMeta("twitter:site", TWITTER_HANDLE);
    upsertMeta("twitter:title", title);
    upsertMeta("twitter:description", description);
    upsertMeta("twitter:image", image);
    upsertMeta("robots", noindex ? "noindex, nofollow" : robots);

    if (canonical) upsertLink("canonical", canonical);
    for (const alt of hreflangAlternatesForPath(path)) {
      upsertLink("alternate", alt.href, alt.hrefLang);
    }

    if (jsonLd) upsertJsonLd("page-json-ld", jsonLd);
    return () => {
      document.getElementById("page-json-ld")?.remove();
    };
  }, [title, description, image, canonical, path, robots, jsonLd, noindex, locale]);

  return null;
}
