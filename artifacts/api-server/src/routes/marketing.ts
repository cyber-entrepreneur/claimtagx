import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { db, marketingEventsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Whitelist of known event names. Anything else gets a 400. Keeps the
// pipeline tight as we add events — surprise event names are usually a bug
// rather than a feature.
const EVENT_NAMES = [
  "pageview",
  "industry_selected",
    "cta_clicked",
    "roi_calculated",
    "form_view",
    "form_start",
    "form_field_error",
    "qualification_opened",
    "qualification_completed",
    "submission_attempted",
    "submission_failed",
    "submission_succeeded",
    "contact_qualified",
    "scheduling_cta_shown",
    "scheduling_cta_clicked",
    "meeting_booked",
] as const;

const EventBody = z.object({
  event: z.enum(EVENT_NAMES),
  // Loose ISO-8601 — the API trusts the server clock for `at`, this is for
  // client-side correlation only and is not persisted.
  occurredAt: z.string().datetime().optional(),
  anonymousId: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  path: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  landingPath: z.string().max(2048).optional(),
  utm: z
    .object({
      source: z.string().max(128).optional(),
      medium: z.string().max(128).optional(),
      campaign: z.string().max(128).optional(),
      term: z.string().max(128).optional(),
      content: z.string().max(128).optional(),
    })
    .optional(),
  // Event-specific props — capped at 4 KB to avoid abuse.
  properties: z.record(z.unknown()).optional(),
});

function extractIp(req: Request): string | undefined {
  // X-Forwarded-For comes from the proxy; trust the first hop only.
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]?.trim();
  }
  return req.ip;
}

// Truncate strings so a misbehaving client can't blow the row size.
function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

router.post("/marketing/events", async (req, res, next) => {
  try {
    const parsed = EventBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }

    const b = parsed.data;

    // Properties capped at 4 KB serialized — protects the DB from runaway payloads.
    const serializedProps = b.properties ? JSON.stringify(b.properties) : null;
    if (serializedProps && serializedProps.length > 4096) {
      res.status(413).json({ error: "Properties too large" });
      return;
    }

    // Cloudflare-style geo headers if present; harmless if not.
    const country =
      (req.headers["cf-ipcountry"] as string | undefined) ?? undefined;
    const region =
      (req.headers["cf-region"] as string | undefined) ?? undefined;
    const city = (req.headers["cf-ipcity"] as string | undefined) ?? undefined;

    await db.insert(marketingEventsTable).values({
      event: b.event,
      anonymousId: truncate(b.anonymousId, 128),
      sessionId: truncate(b.sessionId, 128),
      path: truncate(b.path, 2048),
      referrer: truncate(b.referrer, 2048),
      landingPath: truncate(b.landingPath, 2048),
      utmSource: truncate(b.utm?.source, 128),
      utmMedium: truncate(b.utm?.medium, 128),
      utmCampaign: truncate(b.utm?.campaign, 128),
      utmTerm: truncate(b.utm?.term, 128),
      utmContent: truncate(b.utm?.content, 128),
      ip: truncate(extractIp(req), 64),
      country: truncate(country, 8),
      region: truncate(region, 64),
      city: truncate(city, 128),
      userAgent: truncate(req.headers["user-agent"] as string | undefined, 512),
      properties: b.properties ?? null,
    });

    // 204 keeps the response cheap — no body, no JSON parse on the client.
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "marketing event insert failed");
    next(err);
  }
});

export default router;
