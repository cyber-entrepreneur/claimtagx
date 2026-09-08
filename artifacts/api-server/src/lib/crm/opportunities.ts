import {
  db,
  crmAnalyticsEventsTable,
  crmInquiriesTable,
  crmOpportunitiesTable,
  crmOpportunityStagesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { writeAudit } from "./audit";

export async function convertInquiryToOpportunity(params: {
  inquiryId: string;
  actorStaffId: string;
  idempotencyKey: string;
  amountCents?: number;
  currency?: string;
  stage?: string;
}) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(crmOpportunitiesTable)
      .where(eq(crmOpportunitiesTable.conversionIdempotencyKey, params.idempotencyKey))
      .limit(1);
    if (existing) {
      if (existing.inquiryId !== params.inquiryId) {
        throw Object.assign(new Error("Conversion idempotency key reused with a different inquiry"), { status: 409 });
      }
      return { opportunity: existing, replayed: true as const };
    }
    const [byInquiry] = await tx
      .select()
      .from(crmOpportunitiesTable)
      .where(eq(crmOpportunitiesTable.inquiryId, params.inquiryId))
      .limit(1);
    if (byInquiry) {
      throw Object.assign(new Error("Inquiry already converted"), { status: 409 });
    }
    const [inquiry] = await tx.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.id, params.inquiryId)).limit(1);
    if (!inquiry) throw Object.assign(new Error("Inquiry not found"), { status: 404 });
    const stage = params.stage ?? "qualified";
    const [opp] = await tx
      .insert(crmOpportunitiesTable)
      .values({
        inquiryId: inquiry.id,
        contactId: inquiry.contactId,
        companyId: inquiry.companyId,
        stage,
        amountCents: params.amountCents ?? null,
        currency: params.currency ?? "USD",
        ownerStaffId: inquiry.assignedStaffId,
        source: inquiry.source,
        conversionIdempotencyKey: params.idempotencyKey,
        convertedAt: new Date(),
      })
      .returning();
    await tx.insert(crmOpportunityStagesTable).values({
      opportunityId: opp.id,
      fromStage: null,
      toStage: stage,
      actorStaffId: params.actorStaffId,
    });
    await tx.insert(crmAnalyticsEventsTable).values({
      event: "opportunity_converted",
      inquiryId: inquiry.id,
      contactId: inquiry.contactId,
      properties: { opportunityId: opp.id, source: inquiry.source },
    });
    await writeAudit(
      {
        actorType: "staff",
        actorId: params.actorStaffId,
        action: "opportunity.converted",
        entityType: "opportunity",
        entityId: opp.id,
        inquiryId: inquiry.id,
        contactId: inquiry.contactId,
        afterValue: { stage, amountCents: params.amountCents ?? null },
      },
      tx,
    );
    return { opportunity: opp, replayed: false as const };
  });
}

const STAGE_GRAPH: Record<string, string[]> = {
  new: ["qualified", "lost"],
  qualified: ["proposal", "lost"],
  proposal: ["negotiation", "lost"],
  negotiation: ["won", "lost"],
  won: [],
  lost: [],
};

export async function updateOpportunity(params: {
  id: string;
  actorStaffId: string;
  stage?: string;
  amountCents?: number;
  currency?: string;
  probability?: number;
  expectedCloseAt?: Date;
  lostReason?: string;
  teamId?: string;
}) {
  return db.transaction(async (tx) => {
    const [opp] = await tx.select().from(crmOpportunitiesTable).where(eq(crmOpportunitiesTable.id, params.id)).limit(1);
    if (!opp) throw Object.assign(new Error("Opportunity not found"), { status: 404 });
    if (params.stage && params.stage !== opp.stage) {
      const allowed = STAGE_GRAPH[opp.stage] ?? [];
      if (!allowed.includes(params.stage)) {
        throw Object.assign(new Error(`Invalid stage ${opp.stage} → ${params.stage}`), { status: 409 });
      }
      if (params.stage === "lost" && !params.lostReason) {
        throw Object.assign(new Error("Loss reason is required"), { status: 400 });
      }
      await tx.insert(crmOpportunityStagesTable).values({
        opportunityId: opp.id,
        fromStage: opp.stage,
        toStage: params.stage,
        actorStaffId: params.actorStaffId,
      });
    }
    const [updated] = await tx
      .update(crmOpportunitiesTable)
      .set({
        stage: params.stage ?? opp.stage,
        amountCents: params.amountCents ?? opp.amountCents,
        currency: params.currency ?? opp.currency,
        probability: params.probability ?? opp.probability,
        expectedCloseAt: params.expectedCloseAt ?? opp.expectedCloseAt,
        lostReason: params.lostReason ?? opp.lostReason,
        teamId: params.teamId ?? opp.teamId,
        updatedAt: new Date(),
      })
      .where(eq(crmOpportunitiesTable.id, params.id))
      .returning();
    await writeAudit(
      {
        actorType: "staff",
        actorId: params.actorStaffId,
        action: "opportunity.updated",
        entityType: "opportunity",
        entityId: params.id,
        afterValue: { stage: updated.stage },
      },
      tx,
    );
    return updated;
  });
}
