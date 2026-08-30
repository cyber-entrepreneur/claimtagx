import {
  db,
  crmCompaniesTable,
  crmContactsTable,
  crmInquiriesTable,
  crmInquiryCountersTable,
  crmConversationsTable,
  crmMessagesTable,
  crmInquiryAnswersTable,
  crmConsentRecordsTable,
  crmQualificationModelsTable,
  crmQualificationResultsTable,
  crmRoutingRulesTable,
  crmTeamsTable,
  crmTeamMembersTable,
  crmStaffTable,
  crmSlaPoliciesTable,
  crmSlaInstancesTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { isAcceptablePhone, normalizePhone } from "./phone";
import {
  isImmediatelyQualified,
  scoreInquiry,
  type QualificationModelDef,
  type ScoreRule,
} from "./qualification";
import { buildFacts } from "./facts";
import { matchAllConditions, type Condition } from "./conditions";
import { writeAudit } from "./audit";
import { enqueueJob, generateMeetingInvitation } from "./jobs";
import { ensureCrmSeeded } from "./seed";

export interface PublicSubmission {
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyName: string;
  email: string;
  country: string;
  phoneRaw: string;
  useCaseKeys: string[];
  useCaseOther?: string;
  message: string;
  answers: Record<string, { optionKeys?: string[]; freeText?: string }>;
  termsAccepted: boolean;
  termsVersion: string;
  privacyPolicyVersion: string;
  locale?: string;
  attribution?: Record<string, unknown>;
  idempotencyKey: string;
  honeypot?: string;
}

const rateBuckets = new Map<string, number[]>();

export function rateLimitOk(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    rateBuckets.set(key, hits);
    return false;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return true;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sanitizeMessage(message: string, max: number): string {
  return message.replace(/\u0000/g, "").slice(0, max);
}

function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function nextReference(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [row] = await db
    .insert(crmInquiryCountersTable)
    .values({ year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: crmInquiryCountersTable.year,
      set: { lastNumber: sql`${crmInquiryCountersTable.lastNumber} + 1` },
    })
    .returning();
  return `CTX-${year}-${String(row.lastNumber).padStart(6, "0")}`;
}

async function resolveCompany(name: string, country: string) {
  const nameNormalized = normalizeCompanyName(name);
  const [existing] = await db
    .select()
    .from(crmCompaniesTable)
    .where(eq(crmCompaniesTable.nameNormalized, nameNormalized))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(crmCompaniesTable)
    .values({ name: name.trim(), nameNormalized, country })
    .returning();
  return created;
}

async function resolveContact(input: PublicSubmission, companyId: string, phone: ReturnType<typeof normalizePhone>) {
  const emailNormalized = normalizeEmail(input.email);
  const [byEmail] = await db
    .select()
    .from(crmContactsTable)
    .where(eq(crmContactsTable.emailNormalized, emailNormalized))
    .limit(1);
  if (byEmail) {
    const [updated] = await db
      .update(crmContactsTable)
      .set({
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        jobTitle: input.jobTitle.trim(),
        companyId,
        country: input.country,
        phoneRaw: phone.phoneRaw,
        phoneCountry: phone.phoneCountry,
        phoneCountryCallingCode: phone.phoneCountryCallingCode,
        phoneNationalNumber: phone.phoneNationalNumber,
        phoneE164: phone.phoneE164,
        phoneValidationStatus: phone.phoneValidationStatus,
        phoneType: phone.phoneType,
        locale: input.locale ?? null,
        updatedAt: new Date(),
      })
      .where(eq(crmContactsTable.id, byEmail.id))
      .returning();
    return { contact: updated, matched: true as const };
  }
  if (phone.phoneE164) {
    const [byPhone] = await db
      .select()
      .from(crmContactsTable)
      .where(eq(crmContactsTable.phoneE164, phone.phoneE164))
      .limit(1);
    if (byPhone) {
      const [updated] = await db
        .update(crmContactsTable)
        .set({
          email: input.email.trim(),
          emailNormalized,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          jobTitle: input.jobTitle.trim(),
          companyId,
          country: input.country,
          updatedAt: new Date(),
        })
        .where(eq(crmContactsTable.id, byPhone.id))
        .returning();
      return { contact: updated, matched: true as const };
    }
  }
  const [created] = await db
    .insert(crmContactsTable)
    .values({
      companyId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      jobTitle: input.jobTitle.trim(),
      email: input.email.trim(),
      emailNormalized,
      country: input.country,
      phoneRaw: phone.phoneRaw,
      phoneCountry: phone.phoneCountry,
      phoneCountryCallingCode: phone.phoneCountryCallingCode,
      phoneNationalNumber: phone.phoneNationalNumber,
      phoneE164: phone.phoneE164,
      phoneValidationStatus: phone.phoneValidationStatus,
      phoneType: phone.phoneType,
      locale: input.locale ?? null,
    })
    .returning();
  return { contact: created, matched: false as const };
}

async function activeModel(): Promise<QualificationModelDef> {
  const [row] = await db
    .select()
    .from(crmQualificationModelsTable)
    .where(eq(crmQualificationModelsTable.status, "published"))
    .orderBy(desc(crmQualificationModelsTable.version))
    .limit(1);
  if (!row) throw new Error("No published qualification model");
  return {
    key: row.key,
    name: row.name,
    version: row.version,
    thresholds: row.thresholds as Record<string, number>,
    rules: row.rules as unknown as ScoreRule[],
    id: row.id,
  } as QualificationModelDef & { id: string };
}

async function routeInquiry(facts: Record<string, unknown>) {
  const rules = await db
    .select()
    .from(crmRoutingRulesTable)
    .where(eq(crmRoutingRulesTable.status, "active"))
    .orderBy(crmRoutingRulesTable.priority);
  for (const rule of rules) {
    const match = matchAllConditions(facts, (rule.conditions ?? []) as unknown as Condition[]);
    if (!match.ok) continue;
    let staffId = rule.staffId;
    let teamId = rule.teamId;
    if (rule.strategy === "round_robin" && teamId) {
      const members = await db
        .select()
        .from(crmTeamMembersTable)
        .where(
          and(eq(crmTeamMembersTable.teamId, teamId), eq(crmTeamMembersTable.active, true)),
        );
      if (members.length > 0) {
        const [team] = await db
          .select()
          .from(crmTeamsTable)
          .where(eq(crmTeamsTable.id, teamId))
          .limit(1);
        const idx = team ? team.roundRobinCursor % members.length : 0;
        staffId = members[idx].staffId;
        if (team) {
          await db
            .update(crmTeamsTable)
            .set({ roundRobinCursor: team.roundRobinCursor + 1 })
            .where(eq(crmTeamsTable.id, team.id));
        }
      }
    }
    return {
      teamId,
      staffId,
      reason: rule.reasonTemplate || `Routing rule: ${rule.name}`,
      ruleName: rule.name,
    };
  }
  const [fallbackStaff] = await db
    .select()
    .from(crmStaffTable)
    .where(eq(crmStaffTable.status, "active"))
    .limit(1);
  return {
    teamId: null as string | null,
    staffId: fallbackStaff?.id ?? null,
    reason: "Fallback: first active staff member",
    ruleName: "fallback",
  };
}

async function applySla(inquiryId: string, facts: Record<string, unknown>) {
  const policies = await db
    .select()
    .from(crmSlaPoliciesTable)
    .where(eq(crmSlaPoliciesTable.status, "active"));
  const policy =
    policies.find((p) => matchAllConditions(facts, (p.conditions ?? []) as unknown as Condition[]).ok) ??
    policies[0];
  if (!policy) return;
  const due = new Date(Date.now() + policy.firstResponseMinutes * 60_000);
  await db.insert(crmSlaInstancesTable).values({
    inquiryId,
    policyId: policy.id,
    policyVersion: policy.version,
    measure: "first_response",
    dueAt: due,
    status: "ON_TRACK",
  });
}

export async function submitInquiry(
  input: PublicSubmission,
  meta: { ip?: string; userAgent?: string; correlationId: string },
): Promise<{
  inquiryId: string;
  reference: string;
  qualified: boolean;
  meetingUrl: string | null;
  firstName: string;
}> {
  await ensureCrmSeeded();

  if (input.honeypot) {
    throw Object.assign(new Error("Unable to submit right now."), { status: 400 });
  }
  if (!input.termsAccepted) {
    throw Object.assign(new Error("Please agree to the Terms and Privacy Policy."), {
      status: 400,
    });
  }

  const [existing] = await db
    .select({
      id: crmInquiriesTable.id,
      reference: crmInquiriesTable.reference,
      qualificationStatus: crmInquiriesTable.qualificationStatus,
      contactId: crmInquiriesTable.contactId,
    })
    .from(crmInquiriesTable)
    .where(eq(crmInquiriesTable.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existing) {
    const [contact] = await db
      .select({ firstName: crmContactsTable.firstName })
      .from(crmContactsTable)
      .where(eq(crmContactsTable.id, existing.contactId))
      .limit(1);
    const meetingUrl = isImmediatelyQualified(existing.qualificationStatus)
      ? await generateMeetingInvitation(existing.id)
      : null;
    return {
      inquiryId: existing.id,
      reference: existing.reference,
      qualified: isImmediatelyQualified(existing.qualificationStatus),
      meetingUrl,
      firstName: contact?.firstName ?? input.firstName,
    };
  }

  const phone = normalizePhone(input.phoneRaw, input.country);
  if (!isAcceptablePhone(phone)) {
    throw Object.assign(new Error("Please enter a valid phone number for the selected country."), {
      status: 400,
    });
  }

  const company = await resolveCompany(input.companyName, input.country);
  const { contact, matched } = await resolveContact(input, company.id, phone);
  const reference = await nextReference();
  const answersFlat: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input.answers ?? {})) {
    answersFlat[key] = value.optionKeys ?? [];
  }

  const model = (await activeModel()) as QualificationModelDef & { id?: string };
  const facts = buildFacts({
    country: input.country,
    jobTitle: input.jobTitle,
    useCaseKeys: input.useCaseKeys,
    answers: answersFlat,
  });
  const outcome = scoreInquiry(facts, model);
  const qualified = isImmediatelyQualified(outcome.status);
  facts.qualification = {
    status: outcome.status,
    score: outcome.score,
    immediatelyQualified: qualified,
  };

  const routing = await routeInquiry(facts);
  const message = sanitizeMessage(input.message, 8000);

  const [inquiry] = await db
    .insert(crmInquiriesTable)
    .values({
      reference,
      contactId: contact.id,
      companyId: company.id,
      status: routing.staffId ? "ASSIGNED" : "NEW",
      source: "website",
      channel: "web_form",
      useCaseKeys: input.useCaseKeys,
      useCaseOther: input.useCaseOther ?? null,
      assignedTeamId: routing.teamId,
      assignedStaffId: routing.staffId,
      assignedReason: routing.reason,
      qualificationStatus: outcome.status,
      qualificationScore: outcome.score,
      qualificationGrade: outcome.grade,
      qualificationModelVersion: outcome.modelVersion,
      systemQualificationStatus: outcome.status,
      qualifiedAt: qualified ? new Date() : null,
      lastCustomerMessageAt: new Date(),
      idempotencyKey: input.idempotencyKey,
      attribution: input.attribution ?? {},
    })
    .returning();

  const [conversation] = await db
    .insert(crmConversationsTable)
    .values({ inquiryId: inquiry.id, channel: "web_form" })
    .returning();

  await db.insert(crmMessagesTable).values({
    conversationId: conversation.id,
    inquiryId: inquiry.id,
    kind: "web_form",
    visibility: "customer",
    channel: "web_form",
    authorType: "contact",
    authorContactId: contact.id,
    body: message,
  });

  for (const [questionKey, value] of Object.entries(input.answers ?? {})) {
    await db.insert(crmInquiryAnswersTable).values({
      inquiryId: inquiry.id,
      questionKey,
      optionKeys: value.optionKeys ?? [],
      freeText: value.freeText ?? null,
    });
  }

  await db.insert(crmConsentRecordsTable).values({
    contactId: contact.id,
    inquiryId: inquiry.id,
    kind: "terms_privacy",
    granted: true,
    termsVersion: input.termsVersion,
    privacyPolicyVersion: input.privacyPolicyVersion,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  await db.insert(crmQualificationResultsTable).values({
    inquiryId: inquiry.id,
    modelVersion: outcome.modelVersion,
    score: outcome.score,
    grade: outcome.grade,
    status: outcome.status,
    reasons: outcome.reasons as unknown as Record<string, unknown>[],
    source: "system",
  });

  await applySla(inquiry.id, facts);

  await writeAudit({
    actorType: "system",
    action: "inquiry.created",
    entityType: "inquiry",
    entityId: inquiry.id,
    inquiryId: inquiry.id,
    contactId: contact.id,
    correlationId: meta.correlationId,
    afterValue: {
      reference,
      contactMatched: matched,
      qualification: outcome.status,
      score: outcome.score,
      routing: routing.reason,
    },
  });
  await writeAudit({
    actorType: "system",
    action: matched ? "contact.matched" : "contact.created",
    entityType: "contact",
    entityId: contact.id,
    inquiryId: inquiry.id,
    contactId: contact.id,
    correlationId: meta.correlationId,
  });
  await writeAudit({
    actorType: "system",
    action: "qualification.calculated",
    entityType: "inquiry",
    entityId: inquiry.id,
    inquiryId: inquiry.id,
    afterValue: {
      score: outcome.score,
      status: outcome.status,
      reasons: outcome.reasons as unknown as Record<string, unknown>[],
      model: outcome.modelKey,
      version: outcome.modelVersion,
    },
    correlationId: meta.correlationId,
  });

  if (qualified) {
    await generateMeetingInvitation(inquiry.id);
  }

  await enqueueJob(
    "run_workflows",
    { trigger: "inquiry.created", inquiryId: inquiry.id },
    { correlationId: meta.correlationId },
  );
  await enqueueJob("ai_classify", { inquiryId: inquiry.id }, { correlationId: meta.correlationId });
  await enqueueJob(
    "analytics",
    {
      event: qualified ? "qualified" : "inquiry_created",
      inquiryId: inquiry.id,
      contactId: contact.id,
    },
    { correlationId: meta.correlationId },
  );
  if (routing.staffId) {
    await enqueueJob("notify_staff", {
      staffId: routing.staffId,
      inquiryId: inquiry.id,
      type: qualified ? "qualified_lead" : "new_inquiry",
      title: qualified ? "Qualified lead" : "New inquiry",
      body: reference,
    });
  }

  const ctxMeeting = qualified ? await generateMeetingInvitation(inquiry.id) : null;

  return {
    inquiryId: inquiry.id,
    reference,
    qualified,
    meetingUrl: ctxMeeting,
    firstName: contact.firstName,
  };
}
