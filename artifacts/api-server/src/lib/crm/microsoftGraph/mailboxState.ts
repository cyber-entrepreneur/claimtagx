import { db, crmGraphMailboxStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashClientState } from "./auth";
import type { MicrosoftGraphConfig } from "./config";
import { decryptDeltaLink, deltaLinkFingerprint, encryptDeltaLink } from "./deltaTokenStore";

export async function loadMailboxState(mailboxUpn: string) {
  const [row] = await db
    .select()
    .from(crmGraphMailboxStateTable)
    .where(eq(crmGraphMailboxStateTable.mailboxUpn, mailboxUpn))
    .limit(1);
  return row ?? null;
}

export async function ensureMailboxState(config: MicrosoftGraphConfig) {
  const existing = await loadMailboxState(config.mailboxUpn);
  if (existing) return existing;
  const [row] = await db
    .insert(crmGraphMailboxStateTable)
    .values({
      mailboxUpn: config.mailboxUpn,
      clientStateHash: hashClientState(config.clientState),
    })
    .returning();
  return row;
}

export async function saveSubscriptionState(
  config: MicrosoftGraphConfig,
  subscription: { id: string; expirationDateTime: string },
) {
  await ensureMailboxState(config);
  await db
    .update(crmGraphMailboxStateTable)
    .set({
      subscriptionId: subscription.id,
      subscriptionExpiresAt: new Date(subscription.expirationDateTime),
      clientStateHash: hashClientState(config.clientState),
      updatedAt: new Date(),
    })
    .where(eq(crmGraphMailboxStateTable.mailboxUpn, config.mailboxUpn));
}

export async function readDeltaLink(config: MicrosoftGraphConfig): Promise<string | null> {
  const row = await loadMailboxState(config.mailboxUpn);
  if (!row?.deltaLinkEncrypted) return null;
  return decryptDeltaLink(row.deltaLinkEncrypted, config.deltaEncryptionKey);
}

export async function writeDeltaLink(config: MicrosoftGraphConfig, deltaLink: string) {
  await ensureMailboxState(config);
  await db
    .update(crmGraphMailboxStateTable)
    .set({
      deltaLinkEncrypted: encryptDeltaLink(deltaLink, config.deltaEncryptionKey),
      deltaLinkFingerprint: deltaLinkFingerprint(deltaLink),
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(crmGraphMailboxStateTable.mailboxUpn, config.mailboxUpn));
}

export async function touchMailboxNotification(config: MicrosoftGraphConfig) {
  await ensureMailboxState(config);
  await db
    .update(crmGraphMailboxStateTable)
    .set({ lastNotificationAt: new Date(), updatedAt: new Date() })
    .where(eq(crmGraphMailboxStateTable.mailboxUpn, config.mailboxUpn));
}

export async function subscriptionNeedsRenewal(config: MicrosoftGraphConfig, withinMs = 3_600_000 * 6): Promise<boolean> {
  const row = await loadMailboxState(config.mailboxUpn);
  if (!row?.subscriptionExpiresAt) return true;
  return row.subscriptionExpiresAt.getTime() - Date.now() <= withinMs;
}
