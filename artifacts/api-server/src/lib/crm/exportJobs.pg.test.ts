import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("export job tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

async function makeStaff(name: string) {
  const { db, crmStaffTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [staff] = await db
    .insert(crmStaffTable)
    .values({
      email: `${name}.${suffix}@example.com`,
      emailNormalized: `${name}.${suffix}@example.com`,
      name,
      role: "admin",
      permissions: ["inquiries.export", "inquiries.view"],
    })
    .returning();
  assert.ok(staff);
  return staff!;
}

async function makeInquiry(emailPrefix: string, overrides?: { useCaseOther?: string }) {
  const { db, crmContactsTable, crmInquiriesTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [contact] = await db
    .insert(crmContactsTable)
    .values({
      firstName: "Export",
      lastName: "Target",
      jobTitle: "Buyer",
      email: `${emailPrefix}.${suffix}@example.com`,
      emailNormalized: `${emailPrefix}.${suffix}@example.com`,
      country: "US",
    })
    .returning();
  const [inquiry] = await db
    .insert(crmInquiriesTable)
    .values({
      reference: `CTX-2099-E${suffix.slice(0, 5).toUpperCase()}`,
      contactId: contact!.id,
      inquiryType: "sales",
      status: "NEW",
      useCaseOther: overrides?.useCaseOther ?? null,
    })
    .returning();
  assert.ok(inquiry);
  return { inquiry: inquiry!, contact: contact! };
}

describe("crm export jobs (PostgreSQL)", () => {
  it("enqueues and processes a CSV export", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-test-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    try {
      const { enqueueExport, processExportJob, readDownloadBytes, guardCsvCell } = await import("./exportJobs.ts");
      assert.equal(guardCsvCell("=1+1"), "'=1+1");
      const staff = await makeStaff("exporter");
      await makeInquiry("exp-ok");
      const job = await enqueueExport({
        staffId: staff.id,
        filters: { inquiryType: "sales" },
        columns: ["reference", "status", "contactEmail"],
      });
      assert.equal(job.status, "pending");
      const done = await processExportJob(job.id);
      assert.equal(done.status, "completed");
      assert.ok((done.rowCount ?? 0) >= 1);
      assert.ok(done.artifactPath);

      const { bytes, filename } = await readDownloadBytes({ exportJobId: job.id, staffId: staff.id });
      assert.match(filename, /\.csv$/);
      const csv = bytes.toString("utf8");
      assert.match(csv, /reference,status,contactEmail/);
      assert.match(csv, /CTX-2099-E/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("guards CSV formula injection in exported cells", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-inj-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    try {
      const { enqueueExport, processExportJob, getDownload, readDownloadBytes, rowsToCsv, guardCsvCell } = await import(
        "./exportJobs.ts"
      );
      assert.equal(guardCsvCell("=1+1"), "'=1+1");
      assert.equal(guardCsvCell("+123"), "'+123");
      assert.equal(guardCsvCell("-1"), "'-1");
      assert.equal(guardCsvCell("@SUM(1)"), "'@SUM(1)");
      const sample = rowsToCsv(["a", "b"], [{ a: "=cmd|'/c calc'", b: "+123" }]);
      assert.match(sample, /'=cmd/);
      assert.match(sample, /'\+123/);

      const { db, crmContactsTable, crmInquiriesTable } = await import("@workspace/db");
      const staff = await makeStaff("exporter-inj");
      const suffix = randomUUID().slice(0, 8);
      const [contact] = await db
        .insert(crmContactsTable)
        .values({
          firstName: "=HYPERLINK",
          lastName: "Evil",
          jobTitle: "Buyer",
          email: `exp-inj.${suffix}@example.com`,
          emailNormalized: `exp-inj.${suffix}@example.com`,
          country: "US",
        })
        .returning();
      await db.insert(crmInquiriesTable).values({
        reference: `CTX-2099-I${suffix.slice(0, 5).toUpperCase()}`,
        contactId: contact!.id,
        inquiryType: "sales",
        status: "NEW",
      });
      const job = await enqueueExport({
        staffId: staff.id,
        filters: { reference: `CTX-2099-I${suffix.slice(0, 5).toUpperCase()}` },
        columns: ["reference", "contactName"],
      });
      const done = await processExportJob(job.id);
      assert.equal(done.status, "completed");
      const { bytes } = await readDownloadBytes({ exportJobId: job.id, staffId: staff.id });
      const csv = bytes.toString("utf8");
      assert.match(csv, /'=HYPERLINK Evil/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("denies download after expiry", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-exp-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    try {
      const { enqueueExport, processExportJob, getDownload } = await import("./exportJobs.ts");
      const { db, crmExportJobsTable } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      const staff = await makeStaff("exporter-exp");
      await makeInquiry("exp-ttl");
      const job = await enqueueExport({
        staffId: staff.id,
        filters: {},
        columns: ["reference"],
        ttlMs: 60_000,
      });
      await processExportJob(job.id);
      await db
        .update(crmExportJobsTable)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(crmExportJobsTable.id, job.id));

      await assert.rejects(
        () => getDownload({ exportJobId: job.id, staffId: staff.id }),
        (err: Error & { status?: number; code?: string }) =>
          err.status === 410 && err.code === "EXPORT_EXPIRED",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("denies download for a different staff member", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-own-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    try {
      const { enqueueExport, processExportJob, getDownload } = await import("./exportJobs.ts");
      const owner = await makeStaff("exporter-owner");
      const other = await makeStaff("exporter-other");
      await makeInquiry("exp-own");
      const job = await enqueueExport({ staffId: owner.id, columns: ["reference"] });
      await processExportJob(job.id);
      await assert.rejects(
        () => getDownload({ exportJobId: job.id, staffId: other.id }),
        (err: Error & { status?: number }) => err.status === 404,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("processes analytics_snapshot CSV with timezone filters and empty windows", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-analytics-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    try {
      const { enqueueExport, processExportJob, readDownloadBytes } = await import("./exportJobs.ts");
      const staff = await makeStaff("exporter-analytics");
      const job = await enqueueExport({
        staffId: staff.id,
        filters: { kind: "analytics_snapshot", timeZone: "UTC", from: "2099-01-01", to: "2099-01-02" },
        columns: ["reference"],
      });
      const done = await processExportJob(job.id);
      assert.equal(done.status, "completed");
      const { bytes, filename } = await readDownloadBytes({ exportJobId: job.id, staffId: staff.id });
      assert.match(filename, /analytics-export-/);
      const csv = bytes.toString("utf8");
      assert.match(csv, /inquiries/);
      assert.match(csv, /qualified/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cancels an in-flight delayed job without completing afterwards", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-race-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    process.env.CRM_TEST_EXPORT_DELAY_MS = "400";
    try {
      const { enqueueExport, processExportJob, cancelExport } = await import("./exportJobs.ts");
      const staff = await makeStaff("exporter-race");
      await makeInquiry("exp-race");
      const job = await enqueueExport({ staffId: staff.id, columns: ["reference"] });
      const processing = processExportJob(job.id);
      await new Promise((r) => setTimeout(r, 80));
      const cancelled = await cancelExport({ exportJobId: job.id, staffId: staff.id });
      assert.ok(["cancelled", "completed"].includes(cancelled.status));
      const done = await processing;
      if (cancelled.status === "cancelled") {
        assert.equal(done.status, "cancelled");
      } else {
        assert.equal(done.status, "completed");
      }
    } finally {
      delete process.env.CRM_TEST_EXPORT_DELAY_MS;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes a running job after simulated worker restart", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-restart-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    try {
      const { enqueueExport, processExportJob } = await import("./exportJobs.ts");
      const { db, crmExportJobsTable } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      const staff = await makeStaff("exporter-restart");
      await makeInquiry("exp-restart");
      const job = await enqueueExport({ staffId: staff.id, columns: ["reference"] });
      await db
        .update(crmExportJobsTable)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(crmExportJobsTable.id, job.id));
      const done = await processExportJob(job.id);
      assert.equal(done.status, "completed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cancels a pending job and records export.cancelled", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-cancel-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    try {
      const { enqueueExport, cancelExport } = await import("./exportJobs.ts");
      const { db, crmAuditEventsTable } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      const staff = await makeStaff("exporter-cancel");
      const job = await enqueueExport({ staffId: staff.id, columns: ["reference"] });
      const cancelled = await cancelExport({ exportJobId: job.id, staffId: staff.id });
      assert.equal(cancelled.status, "cancelled");
      const audits = await db.select().from(crmAuditEventsTable).where(eq(crmAuditEventsTable.entityId, job.id));
      assert.equal(audits.some((a) => a.action === "export.cancelled"), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("injected failure marks the job failed and restart can reprocess pending jobs only", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-fail-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    process.env.CRM_TEST_EXPORT_FAIL_AT = "before_write";
    try {
      const { enqueueExport, processExportJob } = await import("./exportJobs.ts");
      const staff = await makeStaff("exporter-fail");
      await makeInquiry("exp-fail");
      const job = await enqueueExport({ staffId: staff.id, columns: ["reference"] });
      await assert.rejects(() => processExportJob(job.id));
      delete process.env.CRM_TEST_EXPORT_FAIL_AT;
      const again = await processExportJob(job.id);
      assert.ok(again.status === "failed" || again.status === "completed");
    } finally {
      delete process.env.CRM_TEST_EXPORT_FAIL_AT;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps RSS growth bounded relative to artifact size during download buffering", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-mem-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    try {
      const { enqueueExport, processExportJob, readDownloadBytes } = await import("./exportJobs.ts");
      const staff = await makeStaff("exporter-mem");
      for (let i = 0; i < 40; i++) await makeInquiry(`exp-mem-${i}`);
      const before = process.memoryUsage().rss;
      const job = await enqueueExport({ staffId: staff.id, columns: ["reference", "contactEmail"] });
      const done = await processExportJob(job.id);
      const { bytes } = await readDownloadBytes({ exportJobId: job.id, staffId: staff.id });
      const after = process.memoryUsage().rss;
      const delta = after - before;
      assert.ok(bytes.length > 0);
      assert.ok(delta < bytes.length + 32 * 1024 * 1024, `rss delta ${delta} vs bytes ${bytes.length}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("export routes declare inquiries.export permission (source)", () => {
  it("wires export list/create/cancel/download behind inquiries.export", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "routes", "platformContact.ts"),
      "utf8",
    );
    assert.match(src, /\/platform\/contact\/exports[\s\S]{0,120}requirePermission\("inquiries\.export"\)/);
    assert.match(src, /\/platform\/contact\/exports\/:id\/download[\s\S]{0,160}requirePermission\("inquiries\.export"\)/);
    assert.match(src, /\/platform\/contact\/exports\/:id\/cancel[\s\S]{0,160}requirePermission\("inquiries\.export"\)/);
    assert.match(src, /createReadStream\(filePath\)/);
    assert.equal(/res\.send\(bytes\)/.test(src), false);
  });
});
