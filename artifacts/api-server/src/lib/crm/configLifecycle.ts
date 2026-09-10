export type ConfigChangeStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "published"
  | "rejected"
  | "rolled_back";

export type ConfigChangeEvent =
  | "submit_review"
  | "approve"
  | "reject"
  | "publish"
  | "rollback"
  | "revise";

export type ConfigChange = {
  status: ConfigChangeStatus;
  authorStaffId: string;
  reviewerStaffId?: string | null;
  entityType?: string;
};

export type TransitionContext = {
  actorStaffId: string;
  actorRole: string;
  permissions?: string[];
  emergencyBypass?: boolean;
  emergencyReason?: string;
  expectedUpdatedAt?: string | null;
  currentUpdatedAt?: string | null;
  expectedLiveVersion?: number | null;
  currentLiveVersion?: number | null;
  afterValue?: Record<string, unknown> | null;
  rationale?: string;
  correlationId?: string;
};

export const GOVERNED_ENTITY_TYPES = [
  "taxonomy",
  "qualification_model",
  "routing_rule",
  "workflow",
  "sla_policy",
  "meeting_type",
  "template_publish",
  "template_version",
  "template_create",
  "macro",
  "tag",
  "notification_policy",
  "business_calendar",
  "retention_policy",
  "spam_bot_policy",
] as const;

export type GovernedEntityType = (typeof GOVERNED_ENTITY_TYPES)[number];

export function isGovernedEntityType(value: string): value is GovernedEntityType {
  return (GOVERNED_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Propose/revise drafts. Distinct from review and publish. */
export const PERMISSION_PROPOSE = "config.propose";
export const PERMISSION_REVIEW = "config.review";
export const PERMISSION_PUBLISH = "config.publish";
export const PERMISSION_EMERGENCY = "config.emergency_bypass";

export function permissionForEvent(event: ConfigChangeEvent): string {
  if (event === "approve" || event === "reject") return PERMISSION_REVIEW;
  if (event === "publish" || event === "rollback") return PERMISSION_PUBLISH;
  return PERMISSION_PROPOSE;
}

export function emergencyBypassAllowed(env: {
  CRM_CONFIG_EMERGENCY_BYPASS?: string;
  NODE_ENV?: string;
}): boolean {
  return env.CRM_CONFIG_EMERGENCY_BYPASS === "true";
}

export function assertEmergencyBypass(
  ctx: TransitionContext,
  env: { CRM_CONFIG_EMERGENCY_BYPASS?: string; NODE_ENV?: string },
): void {
  if (!emergencyBypassAllowed(env) || !ctx.emergencyBypass) {
    throw Object.assign(new Error("Emergency bypass is disabled"), { status: 403 });
  }
  if (!(ctx.permissions ?? []).includes(PERMISSION_EMERGENCY)) {
    throw Object.assign(new Error("Emergency bypass requires config.emergency_bypass"), { status: 403 });
  }
  if (!ctx.emergencyReason || ctx.emergencyReason.trim().length < 12) {
    throw Object.assign(new Error("Emergency bypass requires a reason of at least 12 characters"), { status: 400 });
  }
}

export function assertNoInterveningPublish(input: {
  expectedLiveVersion?: number | null;
  currentLiveVersion?: number | null;
}): void {
  if (input.expectedLiveVersion == null || input.currentLiveVersion == null) return;
  if (input.expectedLiveVersion !== input.currentLiveVersion) {
    throw Object.assign(
      new Error("An intervening published version exists. Refresh and retry."),
      { status: 409 },
    );
  }
}

export function assertOptimisticConcurrency(expected: string | null | undefined, current: string | null | undefined): void {
  if (!expected) return;
  if (!current || expected !== current) {
    throw Object.assign(new Error("This change was updated by someone else. Refresh and retry."), {
      status: 409,
    });
  }
}

export function canApprove(change: ConfigChange, ctx: TransitionContext): boolean {
  if (ctx.emergencyBypass) return true;
  if (ctx.actorStaffId === change.authorStaffId) return false;
  const perms = ctx.permissions ?? [];
  if (perms.includes(PERMISSION_REVIEW) || perms.includes("*") || ctx.actorRole === "admin" || ctx.actorRole === "owner") {
    return true;
  }
  return false;
}

export function nextConfigChangeStatus(
  change: ConfigChange,
  event: ConfigChangeEvent,
  ctx: TransitionContext,
): ConfigChangeStatus {
  if (ctx.expectedUpdatedAt) {
    assertOptimisticConcurrency(ctx.expectedUpdatedAt, ctx.currentUpdatedAt);
  }
  assertNoInterveningPublish({
    expectedLiveVersion: ctx.expectedLiveVersion,
    currentLiveVersion: ctx.currentLiveVersion,
  });
  if (ctx.emergencyBypass) {
    assertEmergencyBypass(ctx, {
      CRM_CONFIG_EMERGENCY_BYPASS: process.env.CRM_CONFIG_EMERGENCY_BYPASS,
      NODE_ENV: process.env.NODE_ENV,
    });
    if (event === "publish") {
      if (ctx.afterValue && change.entityType) {
        assertConfigSchema(change.entityType, ctx.afterValue);
      }
      return "published";
    }
  }
  const mapped = ALLOWED[change.status]?.[event];
  if (!mapped) {
    throw Object.assign(new Error(`Cannot ${event} a ${change.status} change`), { status: 409 });
  }
  if (event === "approve" && !canApprove(change, ctx)) {
    throw Object.assign(new Error("A different reviewer must approve this change"), { status: 403 });
  }
  if (event === "publish") {
    const perms = ctx.permissions ?? [];
    if (perms.length && !perms.includes(PERMISSION_PUBLISH) && !perms.includes("*") && ctx.actorRole !== "owner") {
      throw Object.assign(new Error("Publish permission is required"), { status: 403 });
    }
    if (ctx.actorStaffId === change.authorStaffId && ctx.actorRole !== "owner") {
      throw Object.assign(new Error("Publisher must not be the original author unless owner"), { status: 403 });
    }
  }
  if ((event === "approve" || event === "reject") && ctx.permissions?.length) {
    if (!ctx.permissions.includes(PERMISSION_REVIEW) && !ctx.permissions.includes("*") && ctx.actorRole !== "owner" && ctx.actorRole !== "admin") {
      throw Object.assign(new Error("Review permission is required"), { status: 403 });
    }
  }
  return mapped;
}

export function buildRollbackSuccessor(input: {
  publishedChangeId: string;
  entityType: string;
  entityId: string;
  restoredValue: Record<string, unknown>;
  previousPublishedValue: Record<string, unknown> | null;
  actorStaffId: string;
  correlationId: string;
  nextVersion: number;
}): {
  status: "published";
  rollbackOfId: string;
  version: number;
  afterValue: Record<string, unknown>;
  beforeValue: Record<string, unknown> | null;
} {
  return {
    status: "published",
    rollbackOfId: input.publishedChangeId,
    version: input.nextVersion,
    afterValue: input.restoredValue,
    beforeValue: input.previousPublishedValue,
  };
}

export function auditPayloadForTransition(input: {
  action: ConfigChangeEvent | "emergency_publish";
  actorStaffId: string;
  changeId: string;
  fromStatus: string;
  toStatus: string;
  beforeVersion: number | null;
  afterVersion: number | null;
  rationale?: string;
  correlationId?: string;
  emergency?: boolean;
}): Record<string, unknown> {
  return {
    changeId: input.changeId,
    actorStaffId: input.actorStaffId,
    timestamp: new Date().toISOString(),
    rationale: input.rationale ?? null,
    beforeVersion: input.beforeVersion,
    afterVersion: input.afterVersion,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    correlationId: input.correlationId ?? null,
    severity: input.emergency ? "high" : "info",
    action: input.action,
  };
}

const ALLOWED: Record<ConfigChangeStatus, Partial<Record<ConfigChangeEvent, ConfigChangeStatus>>> = {
  draft: { submit_review: "in_review" },
  in_review: { approve: "approved", reject: "rejected", revise: "draft" },
  approved: { publish: "published", revise: "draft" },
  published: { rollback: "rolled_back" },
  rejected: { revise: "draft" },
  rolled_back: {},
};

export function summarizeImpact(input: {
  entityType: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}): string {
  const keys = new Set([
    ...Object.keys(input.before ?? {}),
    ...Object.keys(input.after ?? {}),
  ]);
  const changed = [...keys].filter((k) => JSON.stringify(input.before?.[k]) !== JSON.stringify(input.after?.[k]));
  if (!changed.length) return `${input.entityType}: no field changes`;
  return `${input.entityType}: ${changed.slice(0, 8).join(", ")}`;
}

export function actionsForStatus(status: ConfigChangeStatus): ConfigChangeEvent[] {
  return Object.keys(ALLOWED[status] ?? {}) as ConfigChangeEvent[];
}

export function thresholdsFromAfter(after: Record<string, unknown>): Record<string, number> {
  const nested = after.thresholds;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, number>;
  }
  return after as Record<string, number>;
}

export function dryRunQualificationThresholds(thresholds: Record<string, number>): string[] {
  const warnings: string[] = [];
  const high = thresholds.HIGH_PRIORITY ?? 0;
  const sales = thresholds.SALES_QUALIFIED ?? 0;
  const mql = thresholds.MARKETING_QUALIFIED ?? 0;
  if (!(high >= sales && sales >= mql && mql >= 0)) {
    warnings.push("Thresholds must satisfy HIGH_PRIORITY ≥ SALES_QUALIFIED ≥ MARKETING_QUALIFIED ≥ 0");
  }
  if (high > 100) warnings.push("HIGH_PRIORITY above 100 is unusual for a 0–100 model");
  return warnings;
}

export function dryRunSlaPolicy(after: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const first = Number(after.firstResponseMinutes);
  if (!Number.isFinite(first) || first <= 0) {
    warnings.push("First response minutes must be greater than 0");
  }
  const tz = typeof after.timeZone === "string" ? after.timeZone : "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    warnings.push(`Invalid IANA time zone: ${tz}`);
  }
  const holidays = after.holidays;
  if (Array.isArray(holidays)) {
    for (const day of holidays) {
      if (typeof day === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        warnings.push(`Holiday ${day} is not YYYY-MM-DD`);
      }
    }
  }
  return warnings;
}

export function dryRunRouting(after: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const strategy = String(after.strategy ?? "");
  if (!["round_robin", "team", "staff"].includes(strategy)) {
    warnings.push(`Unknown routing strategy: ${strategy || "(empty)"}`);
  }
  const priority = Number(after.priority);
  if (!Number.isFinite(priority)) warnings.push("Priority must be a number");
  return warnings;
}

export function dryRunForEntity(entityType: string, after: Record<string, unknown>): string[] {
  if (entityType === "qualification_model") return dryRunQualificationThresholds(thresholdsFromAfter(after));
  if (entityType === "sla_policy") return dryRunSlaPolicy(after);
  if (entityType === "routing_rule") return dryRunRouting(after);
  if (entityType === "business_calendar") {
    const warnings: string[] = [];
    const tz = typeof after.timeZone === "string" ? after.timeZone : "";
    if (!tz) warnings.push("Business calendar requires timeZone");
    else {
      try {
        Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      } catch {
        warnings.push(`Invalid IANA time zone: ${tz}`);
      }
    }
    if (!Array.isArray(after.weekdays) || after.weekdays.length === 0) {
      warnings.push("Business calendar should declare weekdays");
    }
    return warnings;
  }
  if (entityType === "retention_policy") {
    const days = Number(after.retainDays);
    if (!Number.isFinite(days) || days < 1) return ["retainDays must be >= 1"];
    return [];
  }
  if (entityType === "spam_bot_policy") {
    const score = Number(after.blockScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) return ["blockScore must be 0–100"];
    return [];
  }
  if (entityType === "template_create") {
    const warnings: string[] = [];
    if (typeof after.key !== "string" || after.key.trim().length < 2) warnings.push("Template key required");
    if (typeof after.subject !== "string" || !after.subject.trim()) warnings.push("Subject required");
    if (typeof after.body !== "string" || !after.body.trim()) warnings.push("Body required");
    return warnings;
  }
  return [];
}

/** Fatal schema errors. Emergency publish cannot skip this check. */
export function assertConfigSchema(entityType: string, after: Record<string, unknown>): void {
  if (!isGovernedEntityType(entityType)) {
    throw Object.assign(new Error(`Entity type ${entityType} is not governed`), { status: 400 });
  }
  const fatal = dryRunForEntity(entityType, after).filter((w) => !/unusual/i.test(w));
  if (entityType === "taxonomy" && (typeof after.label !== "string" || !after.label.trim())) {
    fatal.push("Taxonomy label is required");
  }
  if (fatal.length) {
    throw Object.assign(new Error(fatal[0]), { status: 400, details: fatal });
  }
}
