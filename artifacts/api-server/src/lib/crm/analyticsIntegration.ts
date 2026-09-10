import { db, crmAnalyticsEventsTable, crmConfigTable } from "@workspace/db";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { decodeTimeIdCursor, encodeTimeIdCursor } from "./keysetCursor";

export const ANALYTICS_EVENT_SCHEMA_VERSION = 1;
export const ANALYTICS_WATERMARK_KEY = "analytics_integration_watermark";

export type AnalyticsPiiClass = "none" | "indirect" | "direct";

export type AnalyticsExportEvent = {
  schemaVersion: number;
  event: string;
  occurredAt: string;
  eventId: string;
  inquiryId: string | null;
  pii: AnalyticsPiiClass;
  properties: Record<string, unknown>;
};

export type AnalyticsWatermark = {
  schemaVersion: number;
  cursor: string;
  eventId: string;
  occurredAt: string;
};

export type AnalyticsDestinationAdapter = {
  name: string;
  sendBatch(batch: { idempotencyKey: string; events: AnalyticsExportEvent[] }): Promise<{ accepted: number }>;
};

const DIRECT_PII_KEYS = /email|phone|name|message|body|address/i;

export function classifyAnalyticsPii(properties: Record<string, unknown>): AnalyticsPiiClass {
  const keys = Object.keys(properties);
  if (keys.some((k) => DIRECT_PII_KEYS.test(k))) return "direct";
  if ("inquiryId" in properties || "contactId" in properties) return "indirect";
  return "none";
}

export function redactForExport(
  properties: Record<string, unknown>,
  pii: AnalyticsPiiClass,
): Record<string, unknown> {
  if (pii !== "direct") return { ...properties };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties)) {
    out[k] = DIRECT_PII_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}

export function batchIdempotencyKey(adapterName: string, cursor: string, schemaVersion: number): string {
  return `analytics-export:v${schemaVersion}:${adapterName}:${cursor || "start"}`;
}

export async function loadAnalyticsWatermark(): Promise<AnalyticsWatermark | null> {
  const [row] = await db.select().from(crmConfigTable).where(eq(crmConfigTable.key, ANALYTICS_WATERMARK_KEY)).limit(1);
  const value = row?.value as AnalyticsWatermark | undefined;
  if (!value?.cursor || !value.eventId) return null;
  return value;
}

export async function saveAnalyticsWatermark(watermark: AnalyticsWatermark): Promise<void> {
  const [existing] = await db.select().from(crmConfigTable).where(eq(crmConfigTable.key, ANALYTICS_WATERMARK_KEY)).limit(1);
  if (existing) {
    await db
      .update(crmConfigTable)
      .set({ value: watermark, updatedAt: new Date() })
      .where(eq(crmConfigTable.key, ANALYTICS_WATERMARK_KEY));
    return;
  }
  await db.insert(crmConfigTable).values({ key: ANALYTICS_WATERMARK_KEY, value: watermark, updatedAt: new Date() });
}

export type MemoryDestination = AnalyticsDestinationAdapter & {
  batches: Array<{ idempotencyKey: string; events: AnalyticsExportEvent[] }>;
};

export function memoryAnalyticsDestination(): MemoryDestination {
  const batches: MemoryDestination["batches"] = [];
  return {
    name: "memory",
    batches,
    async sendBatch(batch) {
      const prior = batches.find((b) => b.idempotencyKey === batch.idempotencyKey);
      if (prior) return { accepted: prior.events.length };
      batches.push(batch);
      return { accepted: batch.events.length };
    },
  };
}

export async function exportAnalyticsBatch(opts: {
  adapter: AnalyticsDestinationAdapter;
  limit?: number;
  replayFromCursor?: string | null;
  backfill?: boolean;
}): Promise<{ exported: number; watermark: AnalyticsWatermark | null; failed: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const start =
    opts.replayFromCursor !== undefined
      ? opts.replayFromCursor
        ? decodeTimeIdCursor(opts.replayFromCursor)
        : null
      : decodeTimeIdCursor((await loadAnalyticsWatermark())?.cursor ?? "");
  const filters = [];
  if (start && !opts.backfill) {
    filters.push(
      or(
        gt(crmAnalyticsEventsTable.createdAt, start.createdAt),
        and(eq(crmAnalyticsEventsTable.createdAt, start.createdAt), gt(crmAnalyticsEventsTable.id, start.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(crmAnalyticsEventsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(crmAnalyticsEventsTable.createdAt, crmAnalyticsEventsTable.id)
    .limit(limit);

  const events: AnalyticsExportEvent[] = rows.map((row) => {
    const properties = (row.properties ?? {}) as Record<string, unknown>;
    const pii = classifyAnalyticsPii(properties);
    return {
      schemaVersion: ANALYTICS_EVENT_SCHEMA_VERSION,
      event: row.event,
      occurredAt: row.createdAt.toISOString(),
      eventId: row.id,
      inquiryId: row.inquiryId,
      pii,
      properties: redactForExport(properties, pii),
    };
  });

  if (!events.length) {
    return { exported: 0, watermark: await loadAnalyticsWatermark(), failed: false };
  }

  const last = rows[rows.length - 1]!;
  const cursor = encodeTimeIdCursor({ createdAt: last.createdAt, id: last.id });
  const idempotencyKey = batchIdempotencyKey(opts.adapter.name, cursor, ANALYTICS_EVENT_SCHEMA_VERSION);
  try {
    await opts.adapter.sendBatch({ idempotencyKey, events });
  } catch {
    return { exported: 0, watermark: await loadAnalyticsWatermark(), failed: true };
  }
  const watermark: AnalyticsWatermark = {
    schemaVersion: ANALYTICS_EVENT_SCHEMA_VERSION,
    cursor,
    eventId: last.id,
    occurredAt: last.createdAt.toISOString(),
  };
  if (!opts.replayFromCursor) {
    await saveAnalyticsWatermark(watermark);
  }
  return { exported: events.length, watermark, failed: false };
}

export async function recordAnalyticsDeletionPropagation(params: {
  contactId: string;
  reason: "deletion" | "correction";
}): Promise<void> {
  await db.insert(crmAnalyticsEventsTable).values({
    event: params.reason === "deletion" ? "privacy_deletion" : "privacy_correction",
    inquiryId: null,
    contactId: params.contactId,
    properties: { schemaVersion: ANALYTICS_EVENT_SCHEMA_VERSION, reason: params.reason },
  });
}

/** Monitoring snapshot for the integration boundary (not a warehouse). */
export async function analyticsIntegrationHealth(): Promise<{
  watermark: AnalyticsWatermark | null;
  pendingApprox: number;
  schemaVersion: number;
}> {
  const watermark = await loadAnalyticsWatermark();
  const start = watermark ? decodeTimeIdCursor(watermark.cursor) : null;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmAnalyticsEventsTable)
    .where(
      start
        ? or(
            gt(crmAnalyticsEventsTable.createdAt, start.createdAt),
            and(eq(crmAnalyticsEventsTable.createdAt, start.createdAt), gt(crmAnalyticsEventsTable.id, start.id)),
          )
        : undefined,
    );
  return { watermark, pendingApprox: Number(count ?? 0), schemaVersion: ANALYTICS_EVENT_SCHEMA_VERSION };
}
