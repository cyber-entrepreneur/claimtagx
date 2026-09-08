import type { Response } from "express";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import {
  assetsTable,
  db,
  eventsTable,
  handlersTable,
  pg,
  pool,
} from "@workspace/db";
import { logger } from "./logger";
import {
  getVenueSigningSecret,
  serializeAsset,
  serializeTamperEvent,
  type SerializedAsset,
  type SerializedTamperEvent,
} from "./assets";

export type AssetEvent =
  | { type: "asset.created"; asset: SerializedAsset; actorEmail: string | null }
  | { type: "asset.released"; asset: SerializedAsset; actorEmail: string | null }
  | {
      type: "signature.invalid";
      tamper: SerializedTamperEvent;
      actorEmail: string | null;
    };

type Subscriber = {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
  // While replay is in progress we buffer concurrent live events here
  // (instead of writing them straight to the wire) so reconnect replay can
  // never sandwich an old asset snapshot AFTER a newer live update. After
  // replay finishes we flush this queue in seq order, skipping anything
  // already emitted by the replay.
  pendingLive: Array<{ event: AssetEvent; seq: number }> | null;
  // Highest seq we've actually written to this connection. Used by the
  // post-replay flush to drop any live event whose seq was already covered
  // by the replay (e.g. live arrived AFTER replay had already emitted it).
  highestEmittedSeq: number;
};

// Local-instance subscribers. We still keep a per-process map of HTTP
// responses so we can fan out incoming notifications to whichever connections
// happen to live on this instance. The cross-instance hop is provided by
// Postgres LISTEN/NOTIFY below, so a publish on instance A reaches every
// subscriber on every instance.
const subscribers = new Map<string, Set<Subscriber>>();

const CHANNEL = "claimtagx_sse_events";
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;
// Cap how many missed events we'll replay on reconnect. If a client comes
// back after being offline for hours and would need more than this many
// events, we tell it to do a one-time full refetch instead. This keeps
// reconnects cheap in the common case (short blip) and bounded in the
// pathological case.
const REPLAY_MAX = 250;

// NOTIFY payloads are limited to 8000 bytes by Postgres. We deliberately
// keep the wire format tiny (just IDs + actor email) and hydrate the full
// event by reading from the database on receipt. That way we never have to
// drop a cross-instance fanout because of payload size — every subscriber on
// every instance reliably gets the event.
type NotifyPayload =
  | {
      kind: "asset";
      type: "asset.created" | "asset.released";
      venueCode: string;
      assetId: string;
      actorEmail: string | null;
      seq: number;
    }
  | {
      kind: "tamper";
      type: "signature.invalid";
      venueCode: string;
      tamperId: string;
      actorEmail: string | null;
      seq: number;
    };

let listenerClient: pg.Client | null = null;
let listenerReady: Promise<void> | null = null;
// True only when the dedicated `LISTEN` connection is fully established and
// has not since errored/ended. Used by `publish()` to decide whether to also
// fan out locally — necessary during cold start and reconnect windows when
// `pg_notify` would otherwise be invisible to subscribers on this instance.
let listenerActive = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function writeEvent(
  res: Response,
  event: AssetEvent,
  seq: number | null,
): void {
  const idLine = seq != null ? `id: ${seq}\n` : "";
  res.write(`${idLine}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function fanout(
  venueCode: string,
  event: AssetEvent,
  seq: number | null,
): void {
  const set = subscribers.get(venueCode);
  if (!set || set.size === 0) return;
  for (const sub of set) {
    // If a replay is still draining for this subscriber, queue the live
    // event by seq instead of writing it now. The replay's flush step
    // delivers everything in monotonic order so the client never sees an
    // older snapshot land after a newer one.
    if (sub.pendingLive && seq != null) {
      sub.pendingLive.push({ event, seq });
      continue;
    }
    try {
      writeEvent(sub.res, event, seq);
      if (seq != null && seq > sub.highestEmittedSeq) {
        sub.highestEmittedSeq = seq;
      }
    } catch {
      // best-effort; the close handler will tidy up
    }
  }
}

async function hydrateAndFanout(payload: NotifyPayload): Promise<void> {
  // Skip the database round-trip entirely when no local subscriber cares.
  // Other instances will hydrate on their own behalf.
  const set = subscribers.get(payload.venueCode);
  if (!set || set.size === 0) return;

  if (payload.kind === "asset") {
    const venueSecret = await getVenueSigningSecret(payload.venueCode);
    const [row] = await db
      .select({
        asset: assetsTable,
        releasedBy: handlersTable.name,
      })
      .from(assetsTable)
      .leftJoin(
        eventsTable,
        and(
          eq(eventsTable.assetId, assetsTable.id),
          eq(eventsTable.type, "release"),
        ),
      )
      .leftJoin(handlersTable, eq(handlersTable.id, eventsTable.handlerId))
      .where(eq(assetsTable.id, payload.assetId))
      .orderBy(desc(eventsTable.at))
      .limit(1);
    if (!row) {
      logger.warn(
        { assetId: payload.assetId, venueCode: payload.venueCode },
        "SSE hydrate: asset row not found",
      );
      return;
    }
    const serialized = serializeAsset(
      row.asset,
      venueSecret,
      payload.type === "asset.released" ? row.releasedBy ?? null : null,
    );
    fanout(
      payload.venueCode,
      {
        type: payload.type,
        asset: serialized,
        actorEmail: payload.actorEmail,
      },
      payload.seq,
    );
    return;
  }

  // tamper event hydration
  const [row] = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.id, payload.tamperId),
        eq(eventsTable.type, "signature_invalid"),
      ),
    )
    .limit(1);
  if (!row) {
    logger.warn(
      { tamperId: payload.tamperId, venueCode: payload.venueCode },
      "SSE hydrate: tamper event not found",
    );
    return;
  }
  fanout(
    payload.venueCode,
    {
      type: "signature.invalid",
      tamper: serializeTamperEvent(row),
      actorEmail: payload.actorEmail,
    },
    payload.seq,
  );
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const backoff = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempts, 6),
  );
  // Add a small jitter so multiple instances don't reconnect in lockstep.
  const jitter = Math.floor(Math.random() * 250);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureListener().catch((err) => {
      logger.error(
        { err, attempt: reconnectAttempts },
        "SSE listener reconnect failed; will retry",
      );
    });
  }, backoff + jitter);
}

function ensureListener(): Promise<void> {
  if (listenerReady) return listenerReady;
  listenerReady = (async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    client.on("error", (err: Error) => {
      logger.error({ err }, "SSE listener client error");
      if (listenerClient === client) {
        listenerClient = null;
        listenerReady = null;
        listenerActive = false;
        try {
          client.end().catch(() => {});
        } catch {
          // ignore
        }
        scheduleReconnect();
      }
    });
    client.on("end", () => {
      if (listenerClient === client) {
        listenerClient = null;
        listenerReady = null;
        listenerActive = false;
        logger.warn("SSE listener client ended; reconnecting");
        scheduleReconnect();
      }
    });
    client.on("notification", (msg: pg.Notification) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      let parsed: NotifyPayload;
      try {
        parsed = JSON.parse(msg.payload) as NotifyPayload;
      } catch (err) {
        logger.warn({ err }, "Failed to parse SSE notification payload");
        return;
      }
      hydrateAndFanout(parsed).catch((err) => {
        logger.error({ err, parsed }, "SSE hydrate/fanout failed");
      });
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
    listenerActive = true;
    reconnectAttempts = 0;
  })().catch((err) => {
    listenerReady = null;
    listenerClient = null;
    listenerActive = false;
    // Initial connect failed — schedule a retry so this instance eventually
    // joins the shared transport even if the database was briefly down.
    scheduleReconnect();
    throw err;
  });
  return listenerReady;
}

function parseLastEventId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

// Replay any events with seq > sinceSeq for this venue. If the gap is too
// large to replay cheaply, send a single `reset` control event so the client
// falls back to a one-time full refetch instead.
async function replayMissed(
  venueCode: string,
  sub: Subscriber,
  sinceSeq: number,
): Promise<void> {
  const res = sub.res;
  // Cheaply count to decide whether replay is sensible. We use REPLAY_MAX+1
  // so we can detect the "too many" case without scanning the whole table.
  const rows = await db
    .select({
      id: eventsTable.id,
      seq: eventsTable.seq,
      type: eventsTable.type,
      assetId: eventsTable.assetId,
      handlerId: eventsTable.handlerId,
    })
    .from(eventsTable)
    .where(and(eq(eventsTable.venueId, venueCode), gt(eventsTable.seq, sinceSeq)))
    .orderBy(asc(eventsTable.seq))
    .limit(REPLAY_MAX + 1);

  if (rows.length === 0) return;

  if (rows.length > REPLAY_MAX) {
    // Too far behind to replay cheaply — tell the client to do a one-time
    // full refetch. We tag it with the latest seq we know about so the
    // client can advance its Last-Event-ID pointer in one hop.
    const [latest] = await db
      .select({ seq: eventsTable.seq })
      .from(eventsTable)
      .where(eq(eventsTable.venueId, venueCode))
      .orderBy(desc(eventsTable.seq))
      .limit(1);
    const latestSeq = latest?.seq ?? sinceSeq;
    res.write(
      `id: ${latestSeq}\nevent: reset\ndata: ${JSON.stringify({ reason: "gap_too_large" })}\n\n`,
    );
    return;
  }

  const venueSecret = await getVenueSigningSecret(venueCode);

  for (const row of rows) {
    if (row.type === "intake" || row.type === "release") {
      if (!row.assetId) continue;
      const handlerId = row.handlerId;
      const [assetRow] = await db
        .select({ asset: assetsTable, releasedBy: handlersTable.name })
        .from(assetsTable)
        .leftJoin(handlersTable, handlerId ? eq(handlersTable.id, handlerId) : sql`false`)
        .where(eq(assetsTable.id, row.assetId))
        .limit(1);
      if (!assetRow) continue;
      const isRelease = row.type === "release";
      const serialized = serializeAsset(
        assetRow.asset,
        venueSecret,
        isRelease ? assetRow.releasedBy ?? null : null,
      );
      writeEvent(
        res,
        {
          type: isRelease ? "asset.released" : "asset.created",
          asset: serialized,
          // Replay carries no actor — clients use this only to reconcile
          // state, not to fire toasts (those already fired live).
          actorEmail: null,
        },
        row.seq,
      );
      if (row.seq > sub.highestEmittedSeq) sub.highestEmittedSeq = row.seq;
    } else if (row.type === "signature_invalid") {
      const [tamperRow] = await db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.id, row.id))
        .limit(1);
      if (!tamperRow) continue;
      writeEvent(
        res,
        {
          type: "signature.invalid",
          tamper: serializeTamperEvent(tamperRow),
          actorEmail: null,
        },
        row.seq,
      );
      if (row.seq > sub.highestEmittedSeq) sub.highestEmittedSeq = row.seq;
    }
  }
}

// Drain the per-subscriber buffer of live events that arrived during
// replay. We sort by seq so the client always sees events in monotonic
// order, and skip anything the replay already covered.
function flushPendingLive(sub: Subscriber): void {
  const queue = sub.pendingLive;
  sub.pendingLive = null;
  if (!queue || queue.length === 0) return;
  queue.sort((a, b) => a.seq - b.seq);
  for (const item of queue) {
    if (item.seq <= sub.highestEmittedSeq) continue;
    try {
      writeEvent(sub.res, item.event, item.seq);
      sub.highestEmittedSeq = item.seq;
    } catch {
      // best-effort; the close handler will tidy up
    }
  }
}

export function subscribe(
  venueCode: string,
  res: Response,
  lastEventIdHeader?: string | string[],
): () => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`retry: 5000\n\n`);

  // Lazily start the LISTEN connection on first subscribe. Failures schedule
  // their own retry inside ensureListener; we just log here.
  ensureListener().catch((err) => {
    logger.error({ err }, "Failed to start SSE Postgres listener");
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // ignore
    }
  }, 25_000);

  const sinceSeq = parseLastEventId(lastEventIdHeader);
  const sub: Subscriber = {
    res,
    heartbeat,
    // Install a live-event queue before joining the fanout so replay can
    // run to completion without any out-of-order interleaving.
    pendingLive: sinceSeq != null ? [] : null,
    highestEmittedSeq: sinceSeq ?? 0,
  };
  let set = subscribers.get(venueCode);
  if (!set) {
    set = new Set();
    subscribers.set(venueCode, set);
  }
  set.add(sub);

  // Replay any events the client missed while disconnected. The subscriber
  // is already registered, but its `pendingLive` queue captures concurrent
  // live events and `flushPendingLive` releases them in seq order once
  // replay finishes — guaranteeing the client never sees an older snapshot
  // arrive after a newer one.
  if (sinceSeq != null) {
    replayMissed(venueCode, sub, sinceSeq)
      .catch((err) => {
        logger.error(
          { err, venueCode, sinceSeq },
          "SSE replay-on-reconnect failed",
        );
        // Safety fallback: if we can't replay, ask the client to do a
        // one-time full refetch so its state can't silently drift until
        // the next live event happens to arrive.
        try {
          res.write(
            `event: reset\ndata: ${JSON.stringify({ reason: "replay_failed" })}\n\n`,
          );
        } catch {
          // ignore — the close handler will tidy up
        }
      })
      .finally(() => {
        flushPendingLive(sub);
      });
  }

  return () => {
    clearInterval(heartbeat);
    const cur = subscribers.get(venueCode);
    if (cur) {
      cur.delete(sub);
      if (cur.size === 0) subscribers.delete(venueCode);
    }
  };
}

function toNotifyPayload(
  venueCode: string,
  event: AssetEvent,
  seq: number,
): NotifyPayload {
  if (event.type === "signature.invalid") {
    return {
      kind: "tamper",
      type: "signature.invalid",
      venueCode,
      tamperId: event.tamper.id,
      actorEmail: event.actorEmail,
      seq,
    };
  }
  return {
    kind: "asset",
    type: event.type,
    venueCode,
    assetId: event.asset.id,
    actorEmail: event.actorEmail,
    seq,
  };
}

export function publish(
  venueCode: string,
  event: AssetEvent,
  seq: number,
): void {
  const payload = JSON.stringify(toNotifyPayload(venueCode, event, seq));

  // If our LISTEN connection is not currently active (cold start, mid
  // reconnect, or the initial connect attempt failed), the NOTIFY round-trip
  // would not be visible to subscribers on this instance. Fan out locally so
  // those subscribers still receive the event. Other instances that DO have
  // an active listener will still get the event via the NOTIFY below.
  // We also kick off a listener attempt so this instance recovers ASAP.
  const localFallback = !listenerActive;
  if (localFallback) {
    fanout(venueCode, event, seq);
    ensureListener().catch(() => {
      // ensureListener already schedules its own retry on failure.
    });
  }

  // Fire-and-forget cross-instance broadcast. The pool client used for
  // NOTIFY is released back immediately. When listenerActive is true, this
  // instance's subscribers receive the event via the LISTEN path (and we
  // skipped the local fanout above to avoid double delivery).
  pool
    .query(`SELECT pg_notify($1, $2)`, [CHANNEL, payload])
    .catch((err) => {
      logger.error(
        { err, venueCode, type: event.type },
        "Failed to publish SSE event via pg_notify",
      );
      // Best-effort local fallback so this instance's subscribers still see
      // the update if NOTIFY itself failed and we hadn't already fanned out
      // locally above.
      if (!localFallback) fanout(venueCode, event, seq);
    });
}
