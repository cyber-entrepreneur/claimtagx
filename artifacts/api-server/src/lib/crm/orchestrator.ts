import {
  db,
  pool,
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
  crmSlaPoliciesTable,
  crmSlaInstancesTable,
  crmAuditEventsTable,
  crmJobsTable,
  type DbSession,
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
import { generateMeetingInvitation } from "./jobs";
import { ensureCrmSeeded } from "./seed";
import { addBusinessMinutes, calendarFromPolicy } from "./slaCalendar";
import { beginSubmitTiming, endSubmitTiming, markSubmitStage } from "./submitTiming";
import { maybeInjectSubmitFailure } from "./submitFailInject";
import { verifyBotProof } from "./botAdapter";
import { withSerializableRetry } from "./txRetry";
import { routeInquiry } from "./routing";

export interface PublicSubmission {
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyName: string;
  email: string;
  country: string;
  phoneRaw: string;
  inquiryType: "sales" | "general" | "technical" | "billing" | "other";
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
  botProof?: string;
}

export { rateLimitOk } from "./rateLimit";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sanitizeMessage(message: string, max: number): string {
  return message.replace(/\u0000/g, "").slice(0, max);
}

function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function nextReference(ex: DbSession): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [row] = await ex
    .insert(crmInquiryCountersTable)
    .values({ year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: crmInquiryCountersTable.year,
      set: { lastNumber: sql`${crmInquiryCountersTable.lastNumber} + 1` },
    })
    .returning();
  return `CTX-${year}-${String(row.lastNumber).padStart(6, "0")}`;
}

/** Realign year counter when a unique reference collision proves the counter lagged. */
async function resyncReferenceCounter(ex: DbSession, year = new Date().getUTCFullYear()): Promise<number> {
  const result = await ex.execute(sql`
    WITH m AS (
      SELECT COALESCE(MAX(SUBSTRING(reference FROM ${`CTX-${year}-(\\d+)`})::int), 0) AS n
      FROM crm_inquiries
      WHERE reference LIKE ${`CTX-${year}-%`}
    )
    INSERT INTO crm_inquiry_counters (year, last_number)
    SELECT ${year}, n FROM m
    ON CONFLICT (year) DO UPDATE
    SET last_number = GREATEST(crm_inquiry_counters.last_number, EXCLUDED.last_number)
    RETURNING last_number
  `);
  const rows =
    (result as unknown as { rows?: Array<{ last_number: number }> }).rows ?? [];
  return Number(rows[0]?.last_number ?? 0);
}

async function resolveCompany(ex: DbSession, name: string, country: string) {
  const nameNormalized = normalizeCompanyName(name);
  const [existing] = await ex
    .select()
    .from(crmCompaniesTable)
    .where(eq(crmCompaniesTable.nameNormalized, nameNormalized))
    .limit(1);
  if (existing) return existing;
  const [created] = await ex
    .insert(crmCompaniesTable)
    .values({ name: name.trim(), nameNormalized, country })
    .onConflictDoUpdate({
      target: crmCompaniesTable.nameNormalized,
      set: { country, updatedAt: new Date() },
    })
    .returning();
  return created;
}

async function resolveContact(
  ex: DbSession,
  input: PublicSubmission,
  companyId: string,
  phone: ReturnType<typeof normalizePhone>,
) {
  const emailNormalized = normalizeEmail(input.email);
  const [byEmail] = await ex
    .select()
    .from(crmContactsTable)
    .where(eq(crmContactsTable.emailNormalized, emailNormalized))
    .limit(1);
  if (byEmail) {
    const [updated] = await ex
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
    const [byPhone] = await ex
      .select()
      .from(crmContactsTable)
      .where(eq(crmContactsTable.phoneE164, phone.phoneE164))
      .limit(1);
    if (byPhone) {
      const [updated] = await ex
        .update(crmContactsTable)
        .set({
          email: input.email.trim(),
          emailNormalized,
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
          locale: input.locale ?? byPhone.locale,
          updatedAt: new Date(),
        })
        .where(eq(crmContactsTable.id, byPhone.id))
        .returning();
      return { contact: updated, matched: true as const };
    }
  }
  const [created] = await ex
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

export async function submitInquiry(
  input: PublicSubmission,
  meta: { ip?: string; userAgent?: string; hostname?: string; correlationId: string },
): Promise<{
  inquiryId: string;
  reference: string;
  qualified: boolean;
  meetingUrl: string | null;
  firstName: string;
  timing?: ReturnType<typeof endSubmitTiming>;
}> {
  beginSubmitTiming(meta.correlationId);
  await ensureCrmSeeded();
  markSubmitStage(meta.correlationId, "ensure_seeded");

  await verifyBotProof(
    {
      honeypot: input.honeypot,
      botProof: input.botProof,
      ip: meta.ip,
      hostname: meta.hostname,
    },
    process.env,
  );
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
  markSubmitStage(meta.correlationId, "idempotency_lookup");
  if (existing) {
    const [contact] = await db
      .select({ firstName: crmContactsTable.firstName })
      .from(crmContactsTable)
      .where(eq(crmContactsTable.id, existing.contactId))
      .limit(1);
    const meetingUrl = isImmediatelyQualified(existing.qualificationStatus)
      ? await generateMeetingInvitation(existing.id)
      : null;
    markSubmitStage(meta.correlationId, "idempotent_return");
    return {
      inquiryId: existing.id,
      reference: existing.reference,
      qualified: isImmediatelyQualified(existing.qualificationStatus),
      meetingUrl,
      firstName: contact?.firstName ?? input.firstName,
      timing: endSubmitTiming(meta.correlationId, pool),
    };
  }

  const phone = normalizePhone(input.phoneRaw, input.country);
  markSubmitStage(meta.correlationId, "normalize_phone");
  if (!isAcceptablePhone(phone)) {
    throw Object.assign(new Error("Please enter a valid phone number for the selected country."), {
      status: 400,
    });
  }

  const answersFlat: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input.answers ?? {})) {
    answersFlat[key] = value.optionKeys ?? [];
  }

  const model = (await activeModel()) as QualificationModelDef & { id?: string };
  markSubmitStage(meta.correlationId, "active_model");
  const facts = buildFacts({
    country: input.country,
    jobTitle: input.jobTitle,
    useCaseKeys: input.useCaseKeys,
    answers: answersFlat,
  });
  const isSales = input.inquiryType === "sales";
  const outcome = isSales
    ? scoreInquiry(facts, model)
    : {
        score: 0,
        grade: "D",
        status: "UNASSESSED",
        reasons: [],
        modelKey: model.key,
        modelVersion: model.version,
      };
  const qualified = isSales && isImmediatelyQualified(outcome.status);
  facts.qualification = {
    status: outcome.status,
    score: outcome.score,
    immediatelyQualified: qualified,
  };
  facts.inquiryType = input.inquiryType;
  markSubmitStage(meta.correlationId, "qualification_cpu");

  const message = sanitizeMessage(input.message, 8000);

  // Atomic system-of-record write + transactional outbox (crm_jobs rows).
  // No email, analytics HTTP, AI, or scheduling I/O inside this transaction.
  let inquiry: typeof crmInquiriesTable.$inferSelect;
  let contactFirstName = input.firstName;
  let committedReference = "";
  try {
    maybeInjectSubmitFailure("before_tx");
    maybeInjectSubmitFailure("pool_exhaust");
    maybeInjectSubmitFailure("db_timeout");
    const committed = await withSerializableRetry(
      () =>
      db.transaction(async (tx) => {
      markSubmitStage(meta.correlationId, "tx_begin");
      // CPU-only SLA due dates before acquiring the year-counter row lock.
      const slaPolicies = await tx
        .select()
        .from(crmSlaPoliciesTable)
        .where(eq(crmSlaPoliciesTable.status, "active"));
      const matchedPolicy =
        slaPolicies.find((p) =>
          matchAllConditions(facts, (p.conditions ?? []) as unknown as Condition[]).ok,
        ) ?? slaPolicies[0];
      const cal = matchedPolicy ? calendarFromPolicy(matchedPolicy) : null;
      const firstDue =
        matchedPolicy && cal
          ? addBusinessMinutes(new Date(), matchedPolicy.firstResponseMinutes, cal)
          : null;
      const resolutionDue =
        matchedPolicy && cal && matchedPolicy.resolutionMinutes
          ? addBusinessMinutes(new Date(), matchedPolicy.resolutionMinutes, cal)
          : null;
      markSubmitStage(meta.correlationId, "tx_sla_compute");

      const company = await resolveCompany(tx, input.companyName, input.country);
      markSubmitStage(meta.correlationId, "tx_resolve_company");
      const { contact, matched } = await resolveContact(tx, input, company.id, phone);
      markSubmitStage(meta.correlationId, "tx_resolve_contact");
      const reference = await nextReference(tx);
      markSubmitStage(meta.correlationId, "tx_next_reference");
      maybeInjectSubmitFailure("during_tx");
      const routing = await routeInquiry(facts, tx);
      markSubmitStage(meta.correlationId, "tx_route");

      const [created] = await tx
        .insert(crmInquiriesTable)
        .values({
          reference,
          contactId: contact.id,
          companyId: company.id,
          status: routing.staffId ? "ASSIGNED" : "NEW",
          source: "website",
          channel: "web_form",
          inquiryType: input.inquiryType,
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
          attribution: {
            ...(input.attribution ?? {}),
            inquiry_type: input.inquiryType,
          },
        })
        .returning();
      markSubmitStage(meta.correlationId, "tx_insert_inquiry");

      const [conversation] = await tx
        .insert(crmConversationsTable)
        .values({ inquiryId: created.id, channel: "web_form" })
        .returning();

      await tx.insert(crmMessagesTable).values({
        conversationId: conversation.id,
        inquiryId: created.id,
        kind: "web_form",
        visibility: "customer",
        channel: "web_form",
        authorType: "contact",
        authorContactId: contact.id,
        body: message,
        direction: "inbound",
        deliveryStatus: "received",
      });
      const { ensureWebsiteIdentity } = await import("./connectors/inbound");
      await ensureWebsiteIdentity({
        contactId: contact.id,
        email: contact.email,
        displayName: `${contact.firstName} ${contact.lastName}`,
        executor: tx,
      });
      markSubmitStage(meta.correlationId, "tx_conversation_message");

      for (const [questionKey, value] of Object.entries(input.answers ?? {})) {
        await tx.insert(crmInquiryAnswersTable).values({
          inquiryId: created.id,
          questionKey,
          optionKeys: value.optionKeys ?? [],
          freeText: value.freeText ?? null,
        });
      }

      await tx.insert(crmConsentRecordsTable).values({
        contactId: contact.id,
        inquiryId: created.id,
        kind: "terms_privacy",
        granted: true,
        termsVersion: input.termsVersion,
        privacyPolicyVersion: input.privacyPolicyVersion,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
      const analyticsGranted = input.attribution?.analyticsConsent === true;
      await tx.insert(crmConsentRecordsTable).values({
        contactId: contact.id,
        inquiryId: created.id,
        kind: "analytics",
        granted: analyticsGranted,
        termsVersion: input.termsVersion,
        privacyPolicyVersion: input.privacyPolicyVersion,
        ip: null,
        userAgent: null,
      });

      await tx.insert(crmQualificationResultsTable).values({
        inquiryId: created.id,
        modelVersion: outcome.modelVersion,
        score: outcome.score,
        grade: outcome.grade,
        status: outcome.status,
        reasons: outcome.reasons as unknown as Record<string, unknown>[],
        source: "system",
      });
      markSubmitStage(meta.correlationId, "tx_consent_qualification");

      if (matchedPolicy && firstDue) {
        await tx.insert(crmSlaInstancesTable).values({
          inquiryId: created.id,
          policyId: matchedPolicy.id,
          policyVersion: matchedPolicy.version,
          measure: "first_response",
          dueAt: firstDue,
          status: "ON_TRACK",
        });
        if (resolutionDue) {
          await tx.insert(crmSlaInstancesTable).values({
            inquiryId: created.id,
            policyId: matchedPolicy.id,
            policyVersion: matchedPolicy.version,
            measure: "resolution",
            dueAt: resolutionDue,
            status: "ON_TRACK",
          });
        }
      }
      markSubmitStage(meta.correlationId, "tx_sla");

      await tx.insert(crmAuditEventsTable).values([
        {
          actorType: "system",
          action: "inquiry.created",
          entityType: "inquiry",
          entityId: created.id,
          inquiryId: created.id,
          contactId: contact.id,
          correlationId: meta.correlationId,
          afterValue: {
            reference,
            contactMatched: matched,
            qualification: outcome.status,
            score: outcome.score,
            routing: routing.reason,
            inquiryType: input.inquiryType,
          },
        },
        {
          actorType: "system",
          action: matched ? "contact.matched" : "contact.created",
          entityType: "contact",
          entityId: contact.id,
          inquiryId: created.id,
          contactId: contact.id,
          correlationId: meta.correlationId,
        },
        {
          actorType: "system",
          action: "qualification.calculated",
          entityType: "inquiry",
          entityId: created.id,
          inquiryId: created.id,
          correlationId: meta.correlationId,
          afterValue: {
            score: outcome.score,
            status: outcome.status,
            reasons: outcome.reasons as unknown as Record<string, unknown>[],
            model: outcome.modelKey,
            version: outcome.modelVersion,
          },
        },
        {
          actorType: "system",
          action: "consent.recorded",
          entityType: "consent",
          entityId: created.id,
          inquiryId: created.id,
          contactId: contact.id,
          correlationId: meta.correlationId,
          afterValue: {
            kinds: ["terms_privacy", "analytics"],
            termsVersion: input.termsVersion,
            privacyPolicyVersion: input.privacyPolicyVersion,
            locale: input.locale ?? null,
            purpose: "contact_inquiry_processing",
            analyticsGranted,
          },
        },
      ]);
      markSubmitStage(meta.correlationId, "tx_audit");

      const outbox = [
        {
          type: "run_workflows",
          payload: { trigger: "inquiry.created", inquiryId: created.id },
          correlationId: meta.correlationId,
        },
        {
          type: "ai_classify",
          payload: { inquiryId: created.id },
          correlationId: meta.correlationId,
        },
      ] as Array<{
        type: string;
        payload: Record<string, unknown>;
        correlationId: string;
      }>;
      if (analyticsGranted) {
        outbox.push({
          type: "analytics",
          payload: {
            event: qualified ? "qualified" : "inquiry_created",
            inquiryId: created.id,
            inquiryType: input.inquiryType,
          },
          correlationId: meta.correlationId,
        });
      }
      if (routing.staffId) {
        outbox.push({
          type: "notify_staff",
          payload: {
            staffId: routing.staffId,
            inquiryId: created.id,
            type: qualified ? "qualified_lead" : "new_inquiry",
            title: qualified ? "Qualified lead" : "New inquiry",
            body: reference,
          },
          correlationId: meta.correlationId,
        });
      }
      await tx.insert(crmJobsTable).values(
        outbox.map((job) => ({
          type: job.type,
          payload: job.payload,
          correlationId: job.correlationId,
        })),
      );
      markSubmitStage(meta.correlationId, "tx_outbox");

      return { created, reference, firstName: contact.firstName };
      }),
      {
        onRetry: async (err) => {
          const code =
            typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
          const constraint =
            typeof err === "object" && err && "constraint" in err
              ? String((err as { constraint: unknown }).constraint)
              : "";
          if (code === "23505" && constraint.includes("reference")) {
            await resyncReferenceCounter(db).catch(() => undefined);
          }
        },
      },
    );
    markSubmitStage(meta.correlationId, "tx_commit");
    inquiry = committed.created;
    committedReference = committed.reference;
    contactFirstName = committed.firstName;
    maybeInjectSubmitFailure("after_commit");
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "23505") {
      const [dup] = await db
        .select({
          id: crmInquiriesTable.id,
          reference: crmInquiriesTable.reference,
          qualificationStatus: crmInquiriesTable.qualificationStatus,
          contactId: crmInquiriesTable.contactId,
        })
        .from(crmInquiriesTable)
        .where(eq(crmInquiriesTable.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (dup) {
        const [c] = await db
          .select({ firstName: crmContactsTable.firstName })
          .from(crmContactsTable)
          .where(eq(crmContactsTable.id, dup.contactId))
          .limit(1);
        const meetingUrl = isImmediatelyQualified(dup.qualificationStatus)
          ? await generateMeetingInvitation(dup.id)
          : null;
        return {
          inquiryId: dup.id,
          reference: dup.reference,
          qualified: isImmediatelyQualified(dup.qualificationStatus),
          meetingUrl,
          firstName: c?.firstName ?? input.firstName,
        };
      }
    }
    throw err;
  }

  const ctxMeeting = qualified ? await generateMeetingInvitation(inquiry.id) : null;
  markSubmitStage(meta.correlationId, "post_commit_meeting");

  return {
    inquiryId: inquiry.id,
    reference: committedReference,
    qualified,
    meetingUrl: ctxMeeting,
    firstName: contactFirstName,
    timing: endSubmitTiming(meta.correlationId, pool),
  };
}
