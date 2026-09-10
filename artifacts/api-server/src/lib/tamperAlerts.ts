import { and, eq, gte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  db,
  eventsTable,
  handlerVenuesTable,
  venuesTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendTamperSpikeEmail } from "./email";
import { getAuthService } from "./auth/composeAuthPlatform";

// ---------------------------------------------------------------------------
// Tamper-attempt spike alerting.
//
// When tamper attempts (signature_invalid events) cross a configurable
// threshold for a single ticket inside a short window, we email every owner
// of the venue so they can react in real time instead of having to watch the
// dashboard. A cooldown event is recorded so the same spike doesn't fan out
// repeatedly while the attacker keeps hammering the same ticket id.
// ---------------------------------------------------------------------------

const ALERT_EVENT_TYPE = "tamper_alert_sent";

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function getThreshold(): number {
  return readPositiveInt(process.env.TAMPER_ALERT_THRESHOLD, 3);
}

function getWindowMs(): number {
  return readPositiveInt(process.env.TAMPER_ALERT_WINDOW_MS, 5 * 60 * 1000);
}

function getCooldownMs(): number {
  return readPositiveInt(
    process.env.TAMPER_ALERT_COOLDOWN_MS,
    30 * 60 * 1000,
  );
}

// pg_advisory_lock takes a signed 64-bit integer. We derive one stably from
// venue+ticket so two API instances always agree on the lock key for the same
// pair, but different pairs don't contend.
function hashLockKey(venueCode: string, ticketId: string): bigint {
  const digest = createHash("sha1")
    .update(`${venueCode}\u0000${ticketId}`)
    .digest();
  // Take the first 8 bytes and reinterpret as a signed bigint.
  let v = 0n;
  for (let i = 0; i < 8; i += 1) v = (v << 8n) | BigInt(digest[i]);
  // Convert to signed 64-bit range expected by pg_advisory_lock.
  if (v >= 1n << 63n) v -= 1n << 64n;
  return v;
}

function getHandlerAppBaseUrl(): string {
  const explicit = process.env.HANDLER_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "") + "/";
  const deployed = process.env.REPLIT_DEPLOYMENT_DOMAIN?.trim();
  if (deployed) return `https://${deployed}/handler/`;
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev}/handler/`;
  return "/handler/";
}

async function getOwnerEmails(venueCode: string): Promise<string[]> {
  const rows = await db
    .select({ userId: handlerVenuesTable.handlerUserId })
    .from(handlerVenuesTable)
    .where(
      and(
        eq(handlerVenuesTable.venueCode, venueCode),
        eq(handlerVenuesTable.role, "owner"),
      ),
    );
  if (rows.length === 0) return [];
  const auth = getAuthService();
  const emails: string[] = [];
  for (const r of rows) {
    try {
      // Owner identity is first-party: resolve the verified email from the
      // handler's auth account (handler_user_id is now an auth account id).
      const email = (await auth.getAccountEmail(r.userId)) ?? "";
      if (email) emails.push(email);
    } catch (err) {
      logger.warn(
        { err, userId: r.userId, venueCode },
        "tamper alert: failed to resolve owner email",
      );
    }
  }
  return emails;
}

async function getVenueName(venueCode: string): Promise<string> {
  const [row] = await db
    .select({ name: venuesTable.name })
    .from(venuesTable)
    .where(eq(venuesTable.id, venueCode))
    .limit(1);
  return row?.name ?? venueCode;
}

/**
 * Check whether the just-recorded tamper attempt pushes this ticket over the
 * configured threshold and, if so, fan out an email to every owner. Safe to
 * call from the request path: it never throws and best-effort logs failures.
 */
export async function maybeAlertOnTamperSpike(params: {
  venueCode: string;
  ticketId: string;
}): Promise<void> {
  const { venueCode } = params;
  const ticketId = params.ticketId?.trim();
  if (!ticketId) return;
  try {
    const threshold = getThreshold();
    const windowMs = getWindowMs();
    const cooldownMs = getCooldownMs();
    const now = Date.now();
    const windowStart = new Date(now - windowMs);
    const cooldownStart = new Date(now - cooldownMs);

    // Did we already fan out an alert for this venue+ticket recently? If so,
    // stay quiet — the owner already knows and we don't want to spam.
    // Use a Postgres advisory lock keyed on the venue+ticket pair so two
    // concurrent threshold-crossing events can't both fan out an alert. The
    // lock is held only for the duration of the cooldown check + claim
    // insert; sending emails happens after we've released it.
    const lockKey = hashLockKey(venueCode, ticketId);

    type ClaimOutcome =
      | { kind: "skip" }
      | { kind: "claim"; claimId: string; attempts: number };

    const outcome = await db.transaction(async (tx): Promise<ClaimOutcome> => {
      const lockResult = await tx.execute<{ acquired: boolean }>(
        sql`select pg_try_advisory_xact_lock(${lockKey}) as acquired`,
      );
      const acquired = lockResult.rows[0]?.acquired === true;
      if (!acquired) return { kind: "skip" };

      const [recentAlert] = await tx
        .select({ id: eventsTable.id })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.venueId, venueCode),
            eq(eventsTable.type, ALERT_EVENT_TYPE),
            gte(eventsTable.at, cooldownStart),
            sql`${eventsTable.meta}->>'ticketId' = ${ticketId}`,
          ),
        )
        .limit(1);
      if (recentAlert) return { kind: "skip" };

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.venueId, venueCode),
            eq(eventsTable.type, "signature_invalid"),
            gte(eventsTable.at, windowStart),
            sql`${eventsTable.meta}->>'ticketId' = ${ticketId}`,
          ),
        );
      if (count < threshold) return { kind: "skip" };

      // Insert the cooldown claim inside the lock so we own the alert and
      // any concurrent caller who later acquires the lock will see this row
      // and skip. We rollback the claim below if every email send fails so
      // we don't permanently suppress alerts after a transient outage.
      const [claim] = await tx
        .insert(eventsTable)
        .values({
          venueId: venueCode,
          type: ALERT_EVENT_TYPE,
          meta: {
            ticketId,
            attempts: count,
            windowMs,
            pending: true,
          },
        })
        .returning({ id: eventsTable.id });
      return { kind: "claim", claimId: claim.id, attempts: count };
    });

    if (outcome.kind === "skip") return;

    const owners = await getOwnerEmails(venueCode);
    if (owners.length === 0) {
      logger.info(
        { venueCode, ticketId, attempts: outcome.attempts },
        "tamper alert: threshold crossed but venue has no owners",
      );
      // Mark the claim as finalised with zero recipients so it still
      // suppresses retries — there's nobody to notify either way.
      await db
        .update(eventsTable)
        .set({
          meta: {
            ticketId,
            attempts: outcome.attempts,
            windowMs,
            recipients: 0,
          },
        })
        .where(eq(eventsTable.id, outcome.claimId));
      return;
    }

    const venueName = await getVenueName(venueCode);
    const link = `${getHandlerAppBaseUrl()}custody?venue=${encodeURIComponent(venueCode)}`;

    const sendResults = await Promise.all(
      owners.map((to) =>
        sendTamperSpikeEmail({
          to,
          venueName,
          venueCode,
          ticketId,
          attempts: outcome.attempts,
          windowMinutes: Math.max(1, Math.round(windowMs / 60_000)),
          link,
        })
          .then(() => true)
          .catch((err) => {
            logger.error(
              { err, venueCode, ticketId, to },
              "tamper alert: failed to send email",
            );
            return false;
          }),
      ),
    );
    const delivered = sendResults.filter(Boolean).length;

    if (delivered === 0) {
      // Every send failed (e.g. provider outage). Roll back the cooldown
      // claim so the next tamper attempt can try again instead of staying
      // silent for the full cooldown.
      await db.delete(eventsTable).where(eq(eventsTable.id, outcome.claimId));
      logger.warn(
        { venueCode, ticketId, attempts: outcome.attempts, recipients: owners.length },
        "tamper alert: all sends failed; cooldown released for retry",
      );
      return;
    }

    await db
      .update(eventsTable)
      .set({
        meta: {
          ticketId,
          attempts: outcome.attempts,
          windowMs,
          recipients: delivered,
        },
      })
      .where(eq(eventsTable.id, outcome.claimId));

    logger.info(
      { venueCode, ticketId, attempts: outcome.attempts, recipients: delivered },
      "tamper alert: spike notification sent to owners",
    );
  } catch (err) {
    logger.error(
      { err, venueCode, ticketId },
      "tamper alert: spike check failed",
    );
  }
}
