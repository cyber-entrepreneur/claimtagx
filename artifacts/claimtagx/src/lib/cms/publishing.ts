import manifest from "../../../content/marketing/manifest.json";
import type { MarketingManifest, MarketingPageEntry, MarketingPublishStatus } from "./types";

const data = manifest as MarketingManifest;

export function marketingManifest(): MarketingManifest {
  return data;
}

export function publishedMarketingPages(locale?: string): MarketingPageEntry[] {
  return data.pages.filter(
    (page) => page.status === "published" && (!locale || page.locales.includes(locale)),
  );
}

export function isMarketingPagePublished(id: string, locale?: string): boolean {
  const page = data.pages.find((entry) => entry.id === id);
  if (!page || page.status !== "published") return false;
  if (locale && !page.locales.includes(locale)) return false;
  return true;
}

export function assertBuildMarketingPublished(requiredIds: string[]): void {
  const missing = requiredIds.filter((id) => !isMarketingPagePublished(id));
  if (missing.length) {
    throw new Error(
      `Marketing CMS build gate failed: unpublished or missing pages: ${missing.join(", ")}`,
    );
  }
}

export function transitionMarketingPage(
  id: string,
  action: "submit_review" | "approve" | "publish" | "reject" | "archive",
): MarketingPageEntry {
  const page = data.pages.find((entry) => entry.id === id);
  if (!page) throw new Error(`Unknown marketing page: ${id}`);
  const next: Record<typeof action, MarketingPublishStatus> = {
    submit_review: "in_review",
    approve: "published",
    publish: "published",
    reject: "draft",
    archive: "archived",
  };
  page.status = next[action];
  page.updatedAt = new Date().toISOString();
  return page;
}
