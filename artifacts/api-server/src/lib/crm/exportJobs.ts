import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, readdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  db,
  crmContactsTable,
  crmExportJobsTable,
  crmInquiriesTable,
  type CrmExportJob,
  type JsonMap,
} from "@workspace/db";
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import { writeAudit } from "./audit";
import { enqueueJob } from "./queue";
import { exportDsarPackage } from "./governance";

export type ExportJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export const DEFAULT_EXPORT_COLUMNS = [
  "reference",
  "status",
  "priority",
  "inquiryType",
  "qualificationStatus",
  "source",
  "contactEmail",
  "contactName",
  "country",
  "createdAt",
  "updatedAt",
] as const;

export type ExportColumn = (typeof DEFAULT_EXPORT_COLUMNS)[number] | string;

const MAX_EXPORT_ROWS = 10_000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function httpError(message: string, status: number, code?: string): Error & { status: number; code?: string } {
  return Object.assign(new Error(message), { status, code });
}

async function loadExportJob(exportJobId: string): Promise<CrmExportJob | undefined> {
  const [row] = await db.select().from(crmExportJobsTable).where(eq(crmExportJobsTable.id, exportJobId)).limit(1);
  return row;
}

async function finishExportIfRunning(
  exportJobId: string,
  patch: {
    status: "completed" | "failed";
    artifactPath?: string | null;
    rowCount?: number;
    error?: string | null;
  },
): Promise<CrmExportJob> {
  const [updated] = await db
    .update(crmExportJobsTable)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(and(eq(crmExportJobsTable.id, exportJobId), eq(crmExportJobsTable.status, "running")))
    .returning();
  if (updated) return updated;
  const current = await loadExportJob(exportJobId);
  if (!current) throw httpError("Export job not found", 404);
  return current;
}

function exportRoot(): string {
  return resolve(process.env.CRM_EXPORT_FS_ROOT ?? join(tmpdir(), "crm-exports"));
}

/** Readyz: export directory must be creatable/writable. */
export async function assertExportStoreReady(): Promise<void> {
  const root = exportRoot();
  await mkdir(root, { recursive: true });
  await access(root);
}

/** Prefix formula-triggering CSV cells so spreadsheet apps treat them as text. */
export function guardCsvCell(value: unknown): string {
  let raw = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(raw)) {
    raw = `'${raw}`;
  }
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(guardCsvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => guardCsvCell(row[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function asJsonMap(value: unknown): JsonMap {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonMap;
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonMap;
  return {};
}

function normalizeColumns(columns: unknown): string[] {
  if (!Array.isArray(columns) || columns.length === 0) {
    return [...DEFAULT_EXPORT_COLUMNS];
  }
  const allowed = new Set<string>(DEFAULT_EXPORT_COLUMNS);
  const out: string[] = [];
  for (const c of columns) {
    if (typeof c === "string" && allowed.has(c) && !out.includes(c)) out.push(c);
  }
  return out.length ? out : [...DEFAULT_EXPORT_COLUMNS];
}

function buildFilterClauses(filters: JsonMap): SQL[] {
  const clauses: SQL[] = [];
  if (typeof filters.status === "string" && filters.status) {
    clauses.push(eq(crmInquiriesTable.status, filters.status));
  }
  if (typeof filters.qualificationStatus === "string" && filters.qualificationStatus) {
    clauses.push(eq(crmInquiriesTable.qualificationStatus, filters.qualificationStatus));
  }
  if (typeof filters.inquiryType === "string" && filters.inquiryType) {
    clauses.push(eq(crmInquiriesTable.inquiryType, filters.inquiryType));
  }
  if (typeof filters.priority === "string" && filters.priority) {
    clauses.push(eq(crmInquiriesTable.priority, filters.priority));
  }
  if (typeof filters.source === "string" && filters.source) {
    clauses.push(eq(crmInquiriesTable.source, filters.source));
  }
  if (typeof filters.assignedStaffId === "string" && filters.assignedStaffId) {
    clauses.push(eq(crmInquiriesTable.assignedStaffId, filters.assignedStaffId));
  }
  if (typeof filters.country === "string" && filters.country) {
    clauses.push(eq(crmContactsTable.country, filters.country.toUpperCase()));
  }
  if (typeof filters.reference === "string" && filters.reference.trim()) {
    clauses.push(ilike(crmInquiriesTable.reference, `%${filters.reference.trim()}%`));
  }
  if (typeof filters.from === "string" && filters.from) {
    const d = new Date(filters.from);
    if (!Number.isNaN(d.getTime())) clauses.push(gte(crmInquiriesTable.createdAt, d));
  }
  if (typeof filters.to === "string" && filters.to) {
    const d = new Date(filters.to);
    if (!Number.isNaN(d.getTime())) clauses.push(lte(crmInquiriesTable.createdAt, d));
  }
  return clauses;
}

function projectRow(
  columns: string[],
  inquiry: typeof crmInquiriesTable.$inferSelect,
  contact: typeof crmContactsTable.$inferSelect | null,
): Record<string, unknown> {
  const map: Record<string, unknown> = {
    reference: inquiry.reference,
    status: inquiry.status,
    priority: inquiry.priority,
    inquiryType: inquiry.inquiryType,
    qualificationStatus: inquiry.qualificationStatus,
    source: inquiry.source,
    contactEmail: contact?.email ?? "",
    contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "",
    country: contact?.country ?? "",
    createdAt: inquiry.createdAt?.toISOString?.() ?? inquiry.createdAt,
    updatedAt: inquiry.updatedAt?.toISOString?.() ?? inquiry.updatedAt,
  };
  const out: Record<string, unknown> = {};
  for (const c of columns) out[c] = map[c] ?? "";
  return out;
}

export async function enqueueExport(params: {
  staffId: string;
  filters?: JsonMap;
  columns?: string[];
  ttlMs?: number;
}): Promise<CrmExportJob> {
  const filters = (params.filters ?? {}) as JsonMap;
  const columns = normalizeColumns(params.columns);
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS));
  const [job] = await db
    .insert(crmExportJobsTable)
    .values({
      staffId: params.staffId,
      filters,
      columns,
      status: "pending",
      expiresAt,
      updatedAt: new Date(),
    })
    .returning();
  if (!job) throw httpError("Failed to create export job", 500);

  await enqueueJob(
    "crm_export",
    { exportJobId: job.id },
    { idempotencyKey: `crm-export:${job.id}`, correlationId: job.id },
  );

  await writeAudit({
    actorType: "staff",
    actorId: params.staffId,
    action: "export.enqueued",
    entityType: "export_job",
    entityId: job.id,
    afterValue: { filters, columns },
  });

  return job;
}

export async function processExportJob(exportJobId: string): Promise<CrmExportJob> {
  const [existing] = await db
    .select()
    .from(crmExportJobsTable)
    .where(eq(crmExportJobsTable.id, exportJobId))
    .limit(1);
  if (!existing) throw httpError("Export job not found", 404);
  if (existing.status === "cancelled") return existing;
  if (existing.status === "completed") return existing;

  const [claimed] = await db
    .update(crmExportJobsTable)
    .set({ status: "running", updatedAt: new Date(), error: null })
    .where(
      and(
        eq(crmExportJobsTable.id, exportJobId),
        sql`${crmExportJobsTable.status} IN ('pending', 'failed', 'running')`,
      ),
    )
    .returning({ id: crmExportJobsTable.id });
  if (!claimed) {
    const [again] = await db
      .select()
      .from(crmExportJobsTable)
      .where(eq(crmExportJobsTable.id, exportJobId))
      .limit(1);
    return again ?? existing;
  }

  const exportDelayMs = Number(process.env.CRM_TEST_EXPORT_DELAY_MS ?? 0);
  if (process.env.NODE_ENV !== "production" && Number.isFinite(exportDelayMs) && exportDelayMs > 0) {
    await new Promise((r) => setTimeout(r, exportDelayMs));
    const [again] = await db.select().from(crmExportJobsTable).where(eq(crmExportJobsTable.id, exportJobId)).limit(1);
    if (again?.status === "cancelled") return again;
  }

  try {
    if (process.env.NODE_ENV !== "production" && process.env.CRM_TEST_EXPORT_FAIL_AT === "before_write") {
      throw Object.assign(new Error("injected export storage failure"), { code: "EXPORT_STORAGE" });
    }
    const [latest] = await db
      .select()
      .from(crmExportJobsTable)
      .where(eq(crmExportJobsTable.id, exportJobId))
      .limit(1);
    const filters = asJsonMap(latest?.filters ?? existing.filters);
    if (filters.kind === "analytics_snapshot") {
      const { parseAnalyticsWindow, analyticsCsv } = await import("./analyticsQuery");
      const { crmSlaInstancesTable } = await import("@workspace/db");
      const window = parseAnalyticsWindow(filters);
      const inquiryRange = and(
        window.from ? gte(crmInquiriesTable.createdAt, window.from) : undefined,
        window.to ? lte(crmInquiriesTable.createdAt, window.to) : undefined,
      );
      const [totals] = await db
        .select({
          total: sql<number>`count(*)::int`,
          qualified: sql<number>`count(*) filter (where qualification_status in ('SALES_QUALIFIED','HIGH_PRIORITY'))::int`,
          open: sql<number>`count(*) filter (where status not in ('CLOSED','RESOLVED','SPAM','CANCELLED'))::int`,
          aging7d: sql<number>`count(*) filter (where last_activity_at < now() - interval '7 days' and status not in ('CLOSED','RESOLVED','SPAM','CANCELLED'))::int`,
        })
        .from(crmInquiriesTable)
        .where(inquiryRange);
      const [sla] = await db
        .select({
          breached: sql<number>`count(*) filter (where status = 'BREACHED')::int`,
        })
        .from(crmSlaInstancesTable);
      const csv = analyticsCsv([
        { metric: "inquiries", value: totals?.total ?? 0 },
        { metric: "qualified", value: totals?.qualified ?? 0 },
        { metric: "open", value: totals?.open ?? 0 },
        { metric: "aging7d", value: totals?.aging7d ?? 0 },
        { metric: "slaBreached", value: sla?.breached ?? 0 },
      ]);
      const digest = createHash("sha256").update(csv).digest("hex").slice(0, 16);
      const root = exportRoot();
      await mkdir(root, { recursive: true });
      const relative = `${existing.staffId}/${exportJobId}-${digest}.csv`;
      const full = resolve(join(root, relative));
      if (!full.startsWith(root)) throw new Error("path traversal blocked");
      await mkdir(resolve(join(root, existing.staffId)), { recursive: true });
      await writeFile(full, csv, "utf8");
      const updated = await finishExportIfRunning(exportJobId, {
        status: "completed",
        artifactPath: relative,
        rowCount: 5,
        error: null,
      });
      if (updated.status === "completed") {
        await writeAudit({
          actorType: "system",
          actorId: "crm_export",
          action: "export.completed",
          entityType: "export_job",
          entityId: exportJobId,
          afterValue: { kind: "analytics_snapshot" },
        });
      }
      return updated;
    }
    if (filters.kind === "dsar") {
      const contactId = String(filters.contactId ?? "");
      if (!contactId) throw new Error("dsar export missing contactId");
      const pack = await exportDsarPackage(contactId, existing.staffId);
      const json = `${JSON.stringify(pack)}\n`;
      const digest = createHash("sha256").update(json).digest("hex").slice(0, 16);
      const root = exportRoot();
      await mkdir(root, { recursive: true });
      const relative = `${existing.staffId}/${exportJobId}-${digest}.json`;
      const full = resolve(join(root, relative));
      if (!full.startsWith(root)) throw new Error("path traversal blocked");
      await mkdir(resolve(join(root, existing.staffId)), { recursive: true });
      if (process.env.NODE_ENV !== "production" && process.env.CRM_TEST_EXPORT_FAIL_AT === "partial_file") {
        await writeFile(full, json.slice(0, Math.min(32, json.length)), "utf8");
        throw Object.assign(new Error("injected export worker crash after partial file"), {
          code: "EXPORT_PARTIAL",
        });
      }
      await writeFile(full, json, "utf8");
      const updated = await finishExportIfRunning(exportJobId, {
        status: "completed",
        artifactPath: relative,
        rowCount: Array.isArray((pack as { attachments?: { manifest?: unknown[] } }).attachments?.manifest)
          ? (pack as { attachments: { manifest: unknown[] } }).attachments.manifest.length
          : 0,
        error: null,
      });
      if (updated.status === "completed") {
        await writeAudit({
          actorType: "system",
          actorId: "crm_export",
          action: "export.completed",
          entityType: "export_job",
          entityId: exportJobId,
          afterValue: { kind: "dsar" },
        });
      }
      return updated;
    }
    const columns = normalizeColumns(existing.columns);
    const clauses = buildFilterClauses(filters);
    const where = clauses.length ? and(...clauses) : undefined;

    const rows = await db
      .select({
        inquiry: crmInquiriesTable,
        contact: crmContactsTable,
      })
      .from(crmInquiriesTable)
      .leftJoin(crmContactsTable, eq(crmInquiriesTable.contactId, crmContactsTable.id))
      .where(where)
      .orderBy(desc(crmInquiriesTable.createdAt))
      .limit(MAX_EXPORT_ROWS);

    const projected = rows.map((r) => projectRow(columns, r.inquiry, r.contact));
    const csv = rowsToCsv(columns, projected);
    const digest = createHash("sha256").update(csv).digest("hex").slice(0, 16);
    const root = exportRoot();
    await mkdir(root, { recursive: true });
    const relative = `${existing.staffId}/${exportJobId}-${digest}.csv`;
    const full = resolve(join(root, relative));
    if (!full.startsWith(root)) throw new Error("path traversal blocked");
    await mkdir(resolve(join(root, existing.staffId)), { recursive: true });
    if (process.env.NODE_ENV !== "production" && process.env.CRM_TEST_EXPORT_FAIL_AT === "partial_file") {
      await writeFile(full, csv.slice(0, Math.min(32, csv.length)), "utf8");
      throw Object.assign(new Error("injected export worker crash after partial file"), {
        code: "EXPORT_PARTIAL",
      });
    }
    await writeFile(full, csv, "utf8");
    if (process.env.NODE_ENV !== "production" && process.env.CRM_TEST_EXPORT_FAIL_AT === "after_write") {
      throw Object.assign(new Error("injected export failure after storage write"), {
        code: "EXPORT_AFTER_WRITE",
      });
    }

    const updated = await finishExportIfRunning(exportJobId, {
      status: "completed",
      artifactPath: relative,
      rowCount: projected.length,
      error: null,
    });

    if (updated.status === "completed") {
      await writeAudit({
        actorType: "system",
        actorId: "crm_export",
        action: "export.completed",
        entityType: "export_job",
        entityId: exportJobId,
        afterValue: { rowCount: projected.length },
      });
    }

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "export failed";
    try {
      const root = exportRoot();
      const dir = resolve(join(root, existing.staffId));
      if (dir.startsWith(root)) {
        const files = await readdir(dir).catch(() => []);
        for (const name of files) {
          if (name.startsWith(`${exportJobId}-`)) {
            await unlink(join(dir, name)).catch(() => undefined);
          }
        }
      }
    } catch {
      /* best-effort: failed jobs must not expose partial artifacts */
    }
    const failed = await finishExportIfRunning(exportJobId, {
      status: "failed",
      error: message.slice(0, 2000),
      artifactPath: null,
    });
    throw Object.assign(err instanceof Error ? err : new Error(message), { exportJob: failed });
  }
}

export async function cancelExport(params: {
  exportJobId: string;
  staffId: string;
}): Promise<CrmExportJob> {
  const [job] = await db
    .select()
    .from(crmExportJobsTable)
    .where(eq(crmExportJobsTable.id, params.exportJobId))
    .limit(1);
  if (!job) throw httpError("Export job not found", 404);
  if (job.staffId !== params.staffId) {
    throw httpError("Export job not found", 404, "EXPORT_OWNERSHIP");
  }
  if (job.status === "completed" || job.status === "cancelled") {
    return job;
  }
  const [updated] = await db
    .update(crmExportJobsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(crmExportJobsTable.id, params.exportJobId),
        eq(crmExportJobsTable.staffId, params.staffId),
      ),
    )
    .returning();
  await writeAudit({
    actorType: "staff",
    actorId: params.staffId,
    action: "export.cancelled",
    entityType: "export_job",
    entityId: params.exportJobId,
  });
  return updated ?? job;
}

export async function listExports(staffId: string, limit = 50): Promise<CrmExportJob[]> {
  return db
    .select()
    .from(crmExportJobsTable)
    .where(eq(crmExportJobsTable.staffId, staffId))
    .orderBy(desc(crmExportJobsTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getExport(params: {
  exportJobId: string;
  staffId: string;
}): Promise<CrmExportJob> {
  const [job] = await db
    .select()
    .from(crmExportJobsTable)
    .where(eq(crmExportJobsTable.id, params.exportJobId))
    .limit(1);
  if (!job || job.staffId !== params.staffId) {
    throw httpError("Export job not found", 404);
  }
  return job;
}

export async function getDownload(params: {
  exportJobId: string;
  staffId: string;
}): Promise<{ job: CrmExportJob; filePath: string; filename: string }> {
  const job = await getExport(params);
  if (job.status !== "completed" || !job.artifactPath) {
    throw httpError("Export artifact not ready", 409, "EXPORT_NOT_READY");
  }
  if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
    throw httpError("Export artifact expired", 410, "EXPORT_EXPIRED");
  }
  const root = exportRoot();
  const full = resolve(join(root, job.artifactPath));
  if (!full.startsWith(root)) throw httpError("Illegal artifact path", 400);
  try {
    await access(full);
  } catch {
    throw httpError("Export artifact missing", 404);
  }
  const kind = asJsonMap(job.filters).kind;
  return {
    job,
    filePath: full,
    filename:
      kind === "dsar"
        ? `dsar-export-${job.id.slice(0, 8)}.json`
        : kind === "analytics_snapshot"
          ? `analytics-export-${job.id.slice(0, 8)}.csv`
          : `inquiries-export-${job.id.slice(0, 8)}.csv`,
  };
}

export async function readDownloadBytes(params: {
  exportJobId: string;
  staffId: string;
}): Promise<{ job: CrmExportJob; bytes: Buffer; filename: string; filePath: string }> {
  const meta = await getDownload(params);
  const bytes = await readFile(meta.filePath);
  return { ...meta, bytes };
}

/** Remove expired completed artifacts. Returns counts for operator visibility. */
export async function cleanupExpiredExports(opts?: {
  failCleanup?: boolean;
}): Promise<{ scanned: number; removed: number; errors: number }> {
  const now = new Date();
  const expired = await db
    .select()
    .from(crmExportJobsTable)
    .where(and(eq(crmExportJobsTable.status, "completed"), lte(crmExportJobsTable.expiresAt, now)))
    .limit(200);
  let removed = 0;
  let errors = 0;
  const root = exportRoot();
  for (const job of expired) {
    if (opts?.failCleanup || (process.env.NODE_ENV !== "production" && process.env.CRM_TEST_EXPORT_FAIL_AT === "cleanup")) {
      errors += 1;
      await writeAudit({
        actorType: "system",
        actorId: "crm_export",
        action: "export.cleanup_failed",
        entityType: "export_job",
        entityId: job.id,
        afterValue: { reason: "injected_or_forced_cleanup_failure" },
      });
      continue;
    }
    if (job.artifactPath) {
      const full = resolve(join(root, job.artifactPath));
      if (full.startsWith(root)) {
        try {
          await unlink(full);
        } catch {
          errors += 1;
        }
      }
    }
    await db
      .update(crmExportJobsTable)
      .set({ artifactPath: null, updatedAt: new Date() })
      .where(eq(crmExportJobsTable.id, job.id));
    await writeAudit({
      actorType: "system",
      actorId: "crm_export",
      action: "export.cleaned",
      entityType: "export_job",
      entityId: job.id,
    });
    removed += 1;
  }
  return { scanned: expired.length, removed, errors };
}

export function dsarStatusFromExport(job: CrmExportJob): "pending" | "running" | "ready" | "failed" | "cancelled" {
  if (job.status === "completed") return "ready";
  if (job.status === "running") return "running";
  if (job.status === "failed") return "failed";
  if (job.status === "cancelled") return "cancelled";
  return "pending";
}

export function dsarStatusPayload(job: CrmExportJob, contactId: string) {
  const status = dsarStatusFromExport(job);
  return {
    exportId: job.id,
    status,
    contactId,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.status === "completed" ? job.updatedAt.toISOString() : null,
    expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
    downloadUrl: status === "ready" ? `/api/platform/contact/exports/${job.id}/download` : null,
    error: job.error ?? null,
  };
}

export async function enqueueDsarExport(params: {
  staffId: string;
  contactId: string;
}): Promise<CrmExportJob> {
  const open = await db
    .select()
    .from(crmExportJobsTable)
    .where(eq(crmExportJobsTable.staffId, params.staffId))
    .orderBy(desc(crmExportJobsTable.createdAt))
    .limit(20);
  const existing = open.find((j) => {
    const f = (j.filters ?? {}) as JsonMap;
    return f.kind === "dsar" && f.contactId === params.contactId && (j.status === "pending" || j.status === "running" || j.status === "completed");
  });
  if (existing && existing.status === "completed" && existing.expiresAt && existing.expiresAt.getTime() > Date.now()) {
    return existing;
  }
  if (existing && (existing.status === "pending" || existing.status === "running")) {
    return existing;
  }
  return enqueueExport({
    staffId: params.staffId,
    filters: { kind: "dsar", contactId: params.contactId },
    columns: ["reference"],
  });
}

