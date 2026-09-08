import {
  db,
  crmChannelIdentitiesTable,
  crmContactsTable,
  type DbSession,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { writeAudit } from "../audit";
import type { CanonicalInboundMessage } from "./types";

export type IdentityResolution = {
  contactId: string;
  identityId: string;
  method: "provider_user_id" | "verified_email" | "verified_phone" | "provisional";
  provisional: boolean;
};

function provisionalEmail(msg: CanonicalInboundMessage): string {
  const id = msg.providerUserId.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "unknown";
  return `${msg.channel}.${id}@identity.invalid`;
}

export async function resolveChannelIdentity(
  tx: DbSession,
  msg: CanonicalInboundMessage,
): Promise<IdentityResolution> {
  const context = msg.providerAccountId;
  const [existing] = await tx
    .select()
    .from(crmChannelIdentitiesTable)
    .where(
      and(
        eq(crmChannelIdentitiesTable.channel, msg.channel),
        eq(crmChannelIdentitiesTable.providerAccountContext, context),
        eq(crmChannelIdentitiesTable.providerUserId, msg.providerUserId),
      ),
    )
    .limit(1);
  if (existing) {
    await tx
      .update(crmChannelIdentitiesTable)
      .set({
        lastSeenAt: new Date(),
        displayName: msg.sender.displayName ?? existing.displayName,
        updatedAt: new Date(),
      })
      .where(eq(crmChannelIdentitiesTable.id, existing.id));
    return { contactId: existing.contactId, identityId: existing.id, method: "provider_user_id", provisional: existing.verificationStatus === "provisional" };
  }

  if (msg.verifiedEmail) {
    const email = msg.verifiedEmail.trim().toLowerCase();
    const [byEmail] = await tx
      .select()
      .from(crmContactsTable)
      .where(eq(crmContactsTable.emailNormalized, email))
      .limit(1);
    if (byEmail) {
      const identity = await insertIdentity(tx, msg, byEmail.id, "verified", "high");
      return { contactId: byEmail.id, identityId: identity.id, method: "verified_email", provisional: false };
    }
  }

  if (msg.verifiedPhone) {
    const [byPhone] = await tx
      .select()
      .from(crmContactsTable)
      .where(eq(crmContactsTable.phoneE164, msg.verifiedPhone))
      .limit(1);
    if (byPhone) {
      const identity = await insertIdentity(tx, msg, byPhone.id, "verified", "high");
      return { contactId: byPhone.id, identityId: identity.id, method: "verified_phone", provisional: false };
    }
  }

  const display = (msg.sender.displayName ?? "Customer").trim() || "Customer";
  const parts = display.split(/\s+/);
  const [created] = await tx
    .insert(crmContactsTable)
    .values({
      firstName: parts[0] ?? "Customer",
      lastName: parts.slice(1).join(" ") || "Unknown",
      jobTitle: "Unknown",
      email: provisionalEmail(msg),
      emailNormalized: provisionalEmail(msg),
      country: "XX",
      phoneE164: msg.verifiedPhone ?? null,
      locale: null,
    })
    .returning();
  const identity = await insertIdentity(tx, msg, created.id, "provisional", "low");
  return { contactId: created.id, identityId: identity.id, method: "provisional", provisional: true };
}

async function insertIdentity(
  tx: DbSession,
  msg: CanonicalInboundMessage,
  contactId: string,
  verificationStatus: string,
  confidence: string,
) {
  const [row] = await tx
    .insert(crmChannelIdentitiesTable)
    .values({
      contactId,
      channel: msg.channel,
      providerAccountContext: msg.providerAccountId,
      providerUserId: msg.providerUserId,
      normalizedEmail: msg.verifiedEmail?.toLowerCase() ?? null,
      normalizedPhone: msg.verifiedPhone ?? null,
      handle: msg.sender.handle ?? null,
      displayName: msg.sender.displayName ?? null,
      verificationStatus,
      confidence,
    })
    .returning();
  return row;
}

export async function staffLinkIdentity(params: {
  identityId: string;
  contactId: string;
  actorStaffId: string;
}): Promise<void> {
  const [identity] = await db
    .select()
    .from(crmChannelIdentitiesTable)
    .where(eq(crmChannelIdentitiesTable.id, params.identityId))
    .limit(1);
  if (!identity) throw Object.assign(new Error("Identity not found"), { status: 404 });
  const before = { contactId: identity.contactId };
  await db
    .update(crmChannelIdentitiesTable)
    .set({
      contactId: params.contactId,
      verificationStatus: "staff_linked",
      confidence: "high",
      mergeProvenance: { linkedBy: params.actorStaffId, at: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(eq(crmChannelIdentitiesTable.id, params.identityId));
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "identity.linked",
    entityType: "channel_identity",
    entityId: params.identityId,
    contactId: params.contactId,
    beforeValue: before,
    afterValue: { contactId: params.contactId },
  });
}

export async function staffUnlinkIdentity(params: {
  identityId: string;
  actorStaffId: string;
}): Promise<void> {
  const [identity] = await db
    .select()
    .from(crmChannelIdentitiesTable)
    .where(eq(crmChannelIdentitiesTable.id, params.identityId))
    .limit(1);
  if (!identity) throw Object.assign(new Error("Identity not found"), { status: 404 });
  const display = identity.displayName ?? "Customer";
  const parts = display.split(/\s+/);
  const email = `${identity.channel}.${identity.providerUserId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)}.${randomUUID().slice(0, 8)}@identity.invalid`;
  const [created] = await db
    .insert(crmContactsTable)
    .values({
      firstName: parts[0] ?? "Customer",
      lastName: parts.slice(1).join(" ") || "Unknown",
      jobTitle: "Unknown",
      email,
      emailNormalized: email,
      country: "XX",
    })
    .returning();
  await db
    .update(crmChannelIdentitiesTable)
    .set({
      contactId: created.id,
      verificationStatus: "provisional",
      confidence: "low",
      mergeProvenance: { unlinkedBy: params.actorStaffId, previousContactId: identity.contactId },
      updatedAt: new Date(),
    })
    .where(eq(crmChannelIdentitiesTable.id, params.identityId));
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "identity.unlinked",
    entityType: "channel_identity",
    entityId: params.identityId,
    contactId: created.id,
    beforeValue: { contactId: identity.contactId },
    afterValue: { contactId: created.id },
  });
}
