export type MarketingPublishStatus = "draft" | "in_review" | "published" | "archived";

export type MarketingPageEntry = {
  id: string;
  status: MarketingPublishStatus;
  locales: string[];
  updatedAt: string;
  author: string;
  reviewer?: string;
  notes?: string;
};

export type MarketingManifest = {
  version: number;
  pages: MarketingPageEntry[];
};

export type MarketingTransition =
  | "submit_review"
  | "approve"
  | "publish"
  | "reject"
  | "archive";

export const MARKETING_TRANSITIONS: Record<MarketingPublishStatus, MarketingTransition[]> = {
  draft: ["submit_review", "archive"],
  in_review: ["approve", "reject"],
  published: ["archive"],
  archived: [],
};
