export type MarketingVersionStatus =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "scheduled"
  | "published"
  | "superseded"
  | "archived";

export type MarketingTransition =
  | "submit_review"
  | "request_changes"
  | "approve"
  | "reject"
  | "schedule"
  | "publish"
  | "unpublish"
  | "archive"
  | "revise";

export const MARKETING_PERMISSIONS = {
  propose: "marketing.propose",
  review: "marketing.review",
  publish: "marketing.publish",
} as const;

const NEXT_STATUS: Record<MarketingTransition, MarketingVersionStatus> = {
  submit_review: "in_review",
  request_changes: "changes_requested",
  approve: "approved",
  reject: "archived",
  schedule: "scheduled",
  publish: "published",
  unpublish: "archived",
  archive: "archived",
  revise: "draft",
};

const ALLOWED: Record<MarketingVersionStatus, MarketingTransition[]> = {
  draft: ["submit_review", "archive"],
  in_review: ["approve", "request_changes", "reject", "archive"],
  changes_requested: ["submit_review", "archive"],
  approved: ["schedule", "publish", "archive"],
  scheduled: ["publish", "archive"],
  published: ["unpublish", "archive"],
  superseded: [],
  archived: [],
};

export function permissionForMarketingTransition(transition: MarketingTransition): string {
  if (transition === "approve" || transition === "request_changes" || transition === "reject") {
    return MARKETING_PERMISSIONS.review;
  }
  if (transition === "publish" || transition === "schedule" || transition === "unpublish") {
    return MARKETING_PERMISSIONS.publish;
  }
  return MARKETING_PERMISSIONS.propose;
}

export function assertMarketingTransition(input: {
  status: MarketingVersionStatus;
  transition: MarketingTransition;
  actorStaffId: string;
  authorStaffId?: string | null;
  reviewerStaffId?: string | null;
  permissions: string[];
  dualControlRequired?: boolean;
  expectedLockVersion?: number;
  currentLockVersion?: number;
}): MarketingVersionStatus {
  if (
    input.expectedLockVersion != null &&
    input.currentLockVersion != null &&
    input.expectedLockVersion !== input.currentLockVersion
  ) {
    throw Object.assign(new Error("Version lock mismatch. Refresh and retry."), { status: 409 });
  }
  if (!input.permissions.includes(permissionForMarketingTransition(input.transition))) {
    throw Object.assign(new Error("Insufficient marketing permission"), { status: 403 });
  }
  if (!ALLOWED[input.status]?.includes(input.transition)) {
    throw Object.assign(new Error(`Invalid transition ${input.transition} from ${input.status}`), { status: 409 });
  }
  if (input.dualControlRequired !== false) {
    if (input.transition === "approve" && input.actorStaffId === input.authorStaffId) {
      throw Object.assign(new Error("Reviewer must differ from author"), { status: 403 });
    }
    if (input.transition === "reject" && input.actorStaffId === input.authorStaffId) {
      throw Object.assign(new Error("Reviewer must differ from author"), { status: 403 });
    }
    if (input.transition === "publish" && input.actorStaffId === input.authorStaffId) {
      throw Object.assign(new Error("Publisher must differ from author"), { status: 403 });
    }
  }
  return NEXT_STATUS[input.transition];
}

export function validateMarketingPublication(input: {
  locale: string;
  title: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  body: Record<string, unknown>;
  requiredLocales?: string[];
  peerLocalesPublished?: string[];
}): string[] {
  const issues: string[] = [];
  if (!input.title.trim()) issues.push("title");
  if (!input.seoTitle?.trim()) issues.push("seoTitle");
  if (!input.seoDescription?.trim()) issues.push("seoDescription");
  if (!input.locale.trim()) issues.push("locale");
  if (Object.keys(input.body).length === 0) issues.push("body");
  for (const required of input.requiredLocales ?? []) {
    if (required === input.locale) continue;
    if (!input.peerLocalesPublished?.includes(required)) issues.push(`missingLocale:${required}`);
  }
  return issues;
}

export function compareMarketingVersions(
  a: { title: string; summary?: string | null; body: Record<string, unknown>; seoTitle?: string | null; seoDescription?: string | null },
  b: { title: string; summary?: string | null; body: Record<string, unknown>; seoTitle?: string | null; seoDescription?: string | null },
): { field: string; before: unknown; after: unknown }[] {
  const diffs: { field: string; before: unknown; after: unknown }[] = [];
  for (const field of ["title", "summary", "seoTitle", "seoDescription"] as const) {
    if ((a[field] ?? null) !== (b[field] ?? null)) {
      diffs.push({ field, before: a[field] ?? null, after: b[field] ?? null });
    }
  }
  if (JSON.stringify(a.body ?? {}) !== JSON.stringify(b.body ?? {})) {
    diffs.push({ field: "body", before: a.body, after: b.body });
  }
  return diffs;
}
