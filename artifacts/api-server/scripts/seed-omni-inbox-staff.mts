/**
 * Seed unified-inbox Playwright identities on an isolated 55432 database.
 */
import { randomUUID } from "node:crypto";
import { ROLE_PERMISSIONS } from "../src/lib/crm/rbac.ts";

const url = process.env.DATABASE_URL ?? "";
if (
  !/127\.0\.0\.1:(55432|55470)/.test(url) ||
  !/claimtagx_crm_verify|claimtagx_crm_e2e|claimtagx_crm_omni|ctx_e2e_[a-f0-9]{8}/.test(url)
) {
  console.error("Refusing seed outside isolated database on 55432|55470");
  process.exit(1);
}

async function main() {
  const { ensureCrmSeeded } = await import("../src/lib/crm/seed.ts");
  await ensureCrmSeeded();
  const {
    db,
    crmStaffTable,
    crmTeamsTable,
    crmTeamMembersTable,
    crmContactsTable,
    crmInquiriesTable,
    crmConversationsTable,
    crmMessagesTable,
    crmChannelAccountsTable,
  } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const suffix = randomUUID().slice(0, 8);
  const [teamA] = await db
    .insert(crmTeamsTable)
    .values({ slug: `omni-a-${suffix}`, name: "Omni Team A" })
    .returning();
  const [teamB] = await db
    .insert(crmTeamsTable)
    .values({ slug: `omni-b-${suffix}`, name: "Omni Team B" })
    .returning();
  assertTeams(teamA && teamB);

  const [admin] = await db
    .insert(crmStaffTable)
    .values({
      email: `omni.admin.${suffix}@example.com`,
      emailNormalized: `omni.admin.${suffix}@example.com`,
      name: "Omni Admin",
      role: "admin",
      permissions: [...ROLE_PERMISSIONS.admin],
      teamId: teamA!.id,
    })
    .returning();
  const [auditor] = await db
    .insert(crmStaffTable)
    .values({
      email: `omni.auditor.${suffix}@example.com`,
      emailNormalized: `omni.auditor.${suffix}@example.com`,
      name: "Omni Auditor",
      role: "auditor",
      permissions: [...ROLE_PERMISSIONS.auditor],
    })
    .returning();
  const [agentA] = await db
    .insert(crmStaffTable)
    .values({
      email: `omni.agent.a.${suffix}@example.com`,
      emailNormalized: `omni.agent.a.${suffix}@example.com`,
      name: "Omni Agent A",
      role: "agent",
      permissions: [...ROLE_PERMISSIONS.agent],
      teamId: teamA!.id,
    })
    .returning();
  const [agentB] = await db
    .insert(crmStaffTable)
    .values({
      email: `omni.agent.b.${suffix}@example.com`,
      emailNormalized: `omni.agent.b.${suffix}@example.com`,
      name: "Omni Agent B",
      role: "agent",
      permissions: [...ROLE_PERMISSIONS.agent],
      teamId: teamB!.id,
    })
    .returning();
  if (!admin || !auditor || !agentA || !agentB) throw new Error("staff insert failed");
  await db.insert(crmTeamMembersTable).values([
    { teamId: teamA!.id, staffId: admin.id },
    { teamId: teamA!.id, staffId: agentA.id },
    { teamId: teamB!.id, staffId: agentB.id },
  ]);

  const [foreignContact] = await db
    .insert(crmContactsTable)
    .values({
      email: `omni.foreign.${suffix}@example.com`,
      emailNormalized: `omni.foreign.${suffix}@example.com`,
      firstName: "Foreign",
      lastName: "TeamB",
      jobTitle: "Buyer",
      country: "US",
    })
    .returning();
  const [foreignInquiry] = await db
    .insert(crmInquiriesTable)
    .values({
      reference: `CTX-OMNI-B-${suffix}`,
      contactId: foreignContact!.id,
      inquiryType: "sales",
      status: "ASSIGNED",
      channel: "web_form",
      assignedTeamId: teamB!.id,
      assignedStaffId: agentB.id,
    })
    .returning();
  const [tiktokAccount] = await db
    .select()
    .from(crmChannelAccountsTable)
    .where(eq(crmChannelAccountsTable.channel, "tiktok"))
    .limit(1);
  const [tiktokContact] = await db
    .insert(crmContactsTable)
    .values({
      email: `omni.tiktok.${suffix}@example.com`,
      emailNormalized: `omni.tiktok.${suffix}@example.com`,
      firstName: "TikTok",
      lastName: "Handoff",
      jobTitle: "Buyer",
      country: "US",
    })
    .returning();
  const [tiktokInquiry] = await db
    .insert(crmInquiriesTable)
    .values({
      reference: `CTX-OMNI-TT-${suffix}`,
      contactId: tiktokContact!.id,
      inquiryType: "general",
      status: "NEW",
      channel: "tiktok",
    })
    .returning();
  const [tiktokConversation] = await db
    .insert(crmConversationsTable)
    .values({
      inquiryId: tiktokInquiry!.id,
      channel: "tiktok",
      channelAccountId: tiktokAccount?.id ?? null,
      status: "open",
      externalThreadId: `tt-${suffix}`,
      contactId: tiktokContact!.id,
    })
    .returning();
  await db.insert(crmMessagesTable).values({
    conversationId: tiktokConversation!.id,
    inquiryId: tiktokInquiry!.id,
    kind: "inbound",
    visibility: "customer",
    channel: "tiktok",
    authorType: "contact",
    body: "TikTok manual handoff only",
    direction: "inbound",
  });

  process.stdout.write(
    JSON.stringify({
      admin: { id: admin.id, email: admin.email },
      auditor: { id: auditor.id, email: auditor.email },
      agentA: { id: agentA.id, email: agentA.email },
      agentB: { id: agentB.id, email: agentB.email },
      teamAId: teamA!.id,
      teamBId: teamB!.id,
      foreignInquiryId: foreignInquiry!.id,
      tiktokInquiryId: tiktokInquiry!.id,
    }),
  );
}

function assertTeams(ok: unknown): asserts ok {
  if (!ok) throw new Error("team insert failed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
