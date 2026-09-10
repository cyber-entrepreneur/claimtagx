import { absoluteUrl, SITE_NAME, SITE_URL } from "./siteConfig";

export function webPageJsonLd(params: {
  name: string;
  description: string;
  url: string;
  locale?: "en" | "ar";
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: params.name,
    description: params.description,
    url: params.url,
    inLanguage: params.locale === "ar" ? "ar" : "en",
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

export function contactPageJsonLd(params: { url: string; locale?: "en" | "ar" }) {
  return {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: params.locale === "ar" ? "تواصل مع ClaimTagX" : "Contact ClaimTagX",
    url: params.url,
    mainEntity: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      email: "info@claimtagx.com",
    },
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export { hreflangAlternatesForPath as hreflangAlternates } from "./legalLocalization";
