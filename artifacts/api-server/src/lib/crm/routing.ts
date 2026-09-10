import {
  db,
  crmInquiriesTable,
  crmRoutingRulesTable,
  crmStaffTable,
  crmTeamMembersTable,
  crmTeamsTable,
  type DbSession,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { matchAllConditions, type Condition } from "./conditions";

export type RoutingResult = {
  teamId: string | null;
  staffId: string | null;
  reason: string;
  ruleName: string;
  unassigned: boolean;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function staffMatchesFacts(
  staff: {
    region: string | null;
    languages: string[] | null;
    specialties: string[] | null;
    oooUntil: Date | null;
    capacityLimit: number | null;
    openCount: number;
  },
  facts: Record<string, unknown>,
  now = new Date(),
): { ok: boolean; reason?: string } {
  if (staff.oooUntil && staff.oooUntil.getTime() > now.getTime()) {
    return { ok: false, reason: "out_of_office" };
  }
  if (staff.capacityLimit != null && staff.openCount >= staff.capacityLimit) {
    return { ok: false, reason: "at_capacity" };
  }
  const wantRegion = typeof facts.region === "string" ? facts.region : null;
  if (wantRegion && staff.region && staff.region !== wantRegion && staff.region !== "global") {
    return { ok: false, reason: "region_mismatch" };
  }
  const wantLang =
    typeof facts.locale === "string"
      ? facts.locale.slice(0, 2).toLowerCase()
      : typeof facts.language === "string"
        ? facts.language.slice(0, 2).toLowerCase()
        : null;
  const langs = asStringArray(staff.languages).map((l) => l.slice(0, 2).toLowerCase());
  if (wantLang && langs.length > 0 && !langs.includes(wantLang) && !langs.includes("*")) {
    return { ok: false, reason: "language_mismatch" };
  }
  const specialty =
    typeof facts.inquirySpecialization === "string"
      ? facts.inquirySpecialization
      : typeof facts.inquiryType === "string"
        ? facts.inquiryType
        : null;
  const specs = asStringArray(staff.specialties);
  if (specialty && specs.length > 0 && !specs.includes(specialty) && !specs.includes("*")) {
    return { ok: false, reason: "specialty_mismatch" };
  }
  return { ok: true };
}

/**
 * Transactional round-robin with capacity / OOO / region / language / specialty filters.
 * Cursor advances atomically via UPDATE … RETURNING so concurrent submits cannot share an assignee
 * when only one eligible seat remains.
 */
export async function routeInquiry(
  facts: Record<string, unknown>,
  ex: DbSession = db,
): Promise<RoutingResult> {
  const rules = await ex
    .select()
    .from(crmRoutingRulesTable)
    .where(eq(crmRoutingRulesTable.status, "active"))
    .orderBy(crmRoutingRulesTable.priority);

  for (const rule of rules) {
    const match = matchAllConditions(facts, (rule.conditions ?? []) as unknown as Condition[]);
    if (!match.ok) continue;

    let staffId = rule.staffId;
    const teamId = rule.teamId;

    if (rule.strategy === "staff" && staffId) {
      const eligible = await filterEligibleStaff(ex, [staffId], facts);
      if (eligible.length === 0) {
        continue;
      }
      return {
        teamId,
        staffId: eligible[0]!.id,
        reason: rule.reasonTemplate || `Routing rule: ${rule.name}`,
        ruleName: rule.name,
        unassigned: false,
      };
    }

    if ((rule.strategy === "round_robin" || rule.strategy === "team") && teamId) {
      const members = await ex
        .select({
          staffId: crmTeamMembersTable.staffId,
          weight: crmTeamMembersTable.weight,
        })
        .from(crmTeamMembersTable)
        .where(and(eq(crmTeamMembersTable.teamId, teamId), eq(crmTeamMembersTable.active, true)));

      if (members.length === 0) continue;

      const eligible = await filterEligibleStaff(
        ex,
        members.map((m) => m.staffId),
        facts,
      );
      if (eligible.length === 0) {
        // Deterministic fallback: leave team assignment but unassigned queue for operators.
        return {
          teamId,
          staffId: null,
          reason: `${rule.reasonTemplate || rule.name}: no eligible assignee (capacity/OOO/skills); queued unassigned`,
          ruleName: rule.name,
          unassigned: true,
        };
      }

      if (rule.strategy === "round_robin") {
        const [advanced] = await ex
          .update(crmTeamsTable)
          .set({ roundRobinCursor: sql`${crmTeamsTable.roundRobinCursor} + 1` })
          .where(eq(crmTeamsTable.id, teamId))
          .returning({ cursor: crmTeamsTable.roundRobinCursor });
        const cursor = (advanced?.cursor ?? 1) - 1;
        const pick = eligible[Math.abs(cursor) % eligible.length]!;
        staffId = pick.id;
      } else {
        staffId = eligible[0]!.id;
      }

      return {
        teamId,
        staffId,
        reason: rule.reasonTemplate || `Routing rule: ${rule.name}`,
        ruleName: rule.name,
        unassigned: false,
      };
    }

    if (staffId || teamId) {
      return {
        teamId,
        staffId,
        reason: rule.reasonTemplate || `Routing rule: ${rule.name}`,
        ruleName: rule.name,
        unassigned: !staffId,
      };
    }
  }

  const [fallbackStaff] = await ex
    .select()
    .from(crmStaffTable)
    .where(eq(crmStaffTable.status, "active"))
    .limit(1);
  return {
    teamId: null,
    staffId: fallbackStaff?.id ?? null,
    reason: fallbackStaff
      ? "Fallback: first active staff member"
      : "Fallback: unassigned queue (no active staff)",
    ruleName: "fallback",
    unassigned: !fallbackStaff,
  };
}

async function filterEligibleStaff(
  ex: DbSession,
  staffIds: string[],
  facts: Record<string, unknown>,
): Promise<Array<{ id: string }>> {
  if (!staffIds.length) return [];
  const staffRows = await ex
    .select({
      id: crmStaffTable.id,
      status: crmStaffTable.status,
      region: crmStaffTable.region,
      languages: crmStaffTable.languages,
      specialties: crmStaffTable.specialties,
      capacityLimit: crmStaffTable.capacityLimit,
      oooUntil: crmStaffTable.oooUntil,
    })
    .from(crmStaffTable)
    .where(and(inArray(crmStaffTable.id, staffIds), eq(crmStaffTable.status, "active")));

  const openCounts = await ex
    .select({
      staffId: crmInquiriesTable.assignedStaffId,
      n: sql<number>`count(*)::int`,
    })
    .from(crmInquiriesTable)
    .where(
      and(
        inArray(crmInquiriesTable.assignedStaffId, staffIds),
        sql`${crmInquiriesTable.status} NOT IN ('CLOSED', 'RESOLVED', 'SPAM')`,
      ),
    )
    .groupBy(crmInquiriesTable.assignedStaffId);

  const byId = new Map(openCounts.map((r) => [r.staffId as string, Number(r.n)]));
  const now = new Date();
  return staffRows
    .filter((row) =>
      staffMatchesFacts(
        {
          region: row.region,
          languages: row.languages,
          specialties: row.specialties,
          oooUntil: row.oooUntil,
          capacityLimit: row.capacityLimit,
          openCount: byId.get(row.id) ?? 0,
        },
        facts,
        now,
      ).ok,
    )
    .map((row) => ({ id: row.id }));
}

/** Test helper: evaluate eligibility without DB open-count (pass openCount). */
export function evaluateStaffEligibilityForTest(
  staff: {
    region: string | null;
    languages: string[] | null;
    specialties: string[] | null;
    oooUntil: Date | null;
    capacityLimit: number | null;
    openCount: number;
  },
  facts: Record<string, unknown>,
) {
  return staffMatchesFacts(staff, facts);
}
