import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import {
  db,
  intercomPresenceTable,
  intercomTransmissionsTable,
  type IntercomTransmission,
} from "@workspace/db";
import {
  requireAuth,
  requireVenueMembership,
} from "../middlewares/requireAuth";
import { ensureVenue } from "../lib/assets";

const router: IRouter = Router();

// Presence rows older than this are considered stale and the handler is
// treated as "left" the channel. Clients should heartbeat by re-POSTing join
// every minute or so while the page is open.
const PRESENCE_TTL_MS = 2 * 60 * 1000;
// Transmissions older than this are pruned on read so the audio_base64 blob
// doesn't grow unbounded.
const TRANSMISSION_RETENTION_MS = 10 * 60 * 1000;

const TransmitBody = z.object({
  audioBase64: z
    .string()
    .min(8)
    // ~512KB encoded ceiling for a single PTT push (a few seconds of opus).
    .max(700_000),
  mimeType: z.string().max(64).optional(),
  durationMs: z.number().int().min(0).max(15_000).optional(),
});

function serializeTx(row: IntercomTransmission) {
  return {
    id: row.id,
    venueCode: row.venueCode,
    senderUserId: row.senderUserId,
    senderName: row.senderName,
    audioBase64: row.audioBase64,
    mimeType: row.mimeType,
    durationMs: row.durationMs,
    createdAt: row.createdAt.getTime(),
  };
}

router.use(
  "/venues/:venueCode/intercom",
  requireAuth,
  requireVenueMembership(),
);

router.post("/venues/:venueCode/intercom/join", async (req, res, next) => {
  try {
    const venueCode = String(req.params.venueCode).toUpperCase();
    await ensureVenue(venueCode);
    const now = new Date();
    await db
      .insert(intercomPresenceTable)
      .values({
        venueCode,
        handlerUserId: req.userId!,
        handlerName: req.userName ?? "Handler",
        joinedAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [
          intercomPresenceTable.venueCode,
          intercomPresenceTable.handlerUserId,
        ],
        set: {
          lastSeenAt: now,
          handlerName: req.userName ?? "Handler",
        },
      });
    res.json({ joinedAt: now.getTime() });
  } catch (err) {
    next(err);
  }
});

router.post("/venues/:venueCode/intercom/leave", async (req, res, next) => {
  try {
    const venueCode = String(req.params.venueCode).toUpperCase();
    await db
      .delete(intercomPresenceTable)
      .where(
        and(
          eq(intercomPresenceTable.venueCode, venueCode),
          eq(intercomPresenceTable.handlerUserId, req.userId!),
        ),
      );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/venues/:venueCode/intercom/presence", async (req, res, next) => {
  try {
    const venueCode = String(req.params.venueCode).toUpperCase();
    const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
    // Drop stale rows so listings stay honest. Cheap because the table is
    // expected to stay in the low hundreds at most.
    await db
      .delete(intercomPresenceTable)
      .where(lt(intercomPresenceTable.lastSeenAt, cutoff));
    const rows = await db
      .select()
      .from(intercomPresenceTable)
      .where(eq(intercomPresenceTable.venueCode, venueCode))
      .orderBy(asc(intercomPresenceTable.joinedAt));
    res.json(
      rows.map((r) => ({
        handlerUserId: r.handlerUserId,
        handlerName: r.handlerName,
        joinedAt: r.joinedAt.getTime(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post(
  "/venues/:venueCode/intercom/transmit",
  async (req, res, next) => {
    try {
      const venueCode = String(req.params.venueCode).toUpperCase();
      const parsed = TransmitBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }
      await ensureVenue(venueCode);
      // Refresh presence so the act of transmitting also keeps the handler
      // listed as on the channel.
      const now = new Date();
      await db
        .insert(intercomPresenceTable)
        .values({
          venueCode,
          handlerUserId: req.userId!,
          handlerName: req.userName ?? "Handler",
          joinedAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [
            intercomPresenceTable.venueCode,
            intercomPresenceTable.handlerUserId,
          ],
          set: { lastSeenAt: now },
        });
      const [inserted] = await db
        .insert(intercomTransmissionsTable)
        .values({
          venueCode,
          senderUserId: req.userId!,
          senderName: req.userName ?? "Handler",
          audioBase64: parsed.data.audioBase64,
          mimeType: parsed.data.mimeType ?? "audio/webm",
          durationMs: parsed.data.durationMs ?? 0,
        })
        .returning();
      res.status(201).json(serializeTx(inserted));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/venues/:venueCode/intercom/transmissions",
  async (req, res, next) => {
    try {
      const venueCode = String(req.params.venueCode).toUpperCase();
      const sinceRaw = Number(req.query.since);
      const since = Number.isFinite(sinceRaw) && sinceRaw > 0
        ? new Date(sinceRaw)
        : new Date(Date.now() - TRANSMISSION_RETENTION_MS);
      // Server-side self-filter. We match on the first-party auth account id
      // (req.userId) rather than display name so two handlers with the same
      // first name don't accidentally mute each other.
      const excludeSelfRaw = String(req.query.excludeSelf ?? "").toLowerCase();
      const excludeSelf =
        excludeSelfRaw === "true" || excludeSelfRaw === "1";

      // Prune anything beyond the retention window.
      await db
        .delete(intercomTransmissionsTable)
        .where(
          lt(
            intercomTransmissionsTable.createdAt,
            new Date(Date.now() - TRANSMISSION_RETENTION_MS),
          ),
        );

      const conditions = [
        eq(intercomTransmissionsTable.venueCode, venueCode),
        gt(intercomTransmissionsTable.createdAt, since),
      ];
      if (excludeSelf && req.userId) {
        conditions.push(
          ne(intercomTransmissionsTable.senderUserId, req.userId),
        );
      }
      const rows = await db
        .select()
        .from(intercomTransmissionsTable)
        .where(and(...conditions))
        .orderBy(desc(intercomTransmissionsTable.createdAt))
        .limit(50);
      rows.reverse();
      res.json(rows.map(serializeTx));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
// Keep `sql` referenced for future analytics queries on this router.
void sql;
