import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("DSAR attachment export tests require isolated DATABASE_URL");
  }
}

async function listenApp(): Promise<{ server: Server; base: string }> {
  process.env.CRM_HTTP_TEST_AUTH = "true";
  process.env.NODE_ENV = "development";
  const { default: app } = await import("../../app.ts");
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

describe("DSAR attachment export job/download", () => {
  it("packages clean bytes, withholds quarantine/pending/mismatch, and expires downloads", async () => {
    requireIsolatedDb();
    const exportRoot = await mkdtemp(join(tmpdir(), "crm-dsar-export-"));
    process.env.CRM_EXPORT_FS_ROOT = exportRoot;
    process.env.CRM_ATTACHMENT_STORE = "memory";
    process.env.CRM_ALLOW_TEST_JOBS = "true";

    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmContactsTable, crmInquiriesTable, crmAttachmentsTable } = await import("@workspace/db");
    const { memoryObjectStore } = await import("./attachmentStore.ts");
    const suffix = randomUUID().slice(0, 8);
    const [exporter] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.exp.${suffix}@example.com`,
        emailNormalized: `dsar.exp.${suffix}@example.com`,
        name: "DSAR Exporter",
        role: "admin",
        permissions: ["inquiries.export", "inquiries.view"],
      })
      .returning();
    const [viewer] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.view.${suffix}@example.com`,
        emailNormalized: `dsar.view.${suffix}@example.com`,
        name: "Viewer",
        role: "analyst",
        permissions: ["inquiries.view"],
      })
      .returning();
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Dsar",
        lastName: "Subject",
        jobTitle: "Buyer",
        email: `dsar.sub.${suffix}@example.com`,
        emailNormalized: `dsar.sub.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-2099-D${suffix.slice(0, 5).toUpperCase()}`,
        contactId: contact!.id,
        inquiryType: "sales",
        status: "NEW",
      })
      .returning();

    const clean = Buffer.from("clean-file-bytes");
    const cleanHash = createHash("sha256").update(clean).digest("hex");
    const mismatchBytes = Buffer.from("tampered");
    await memoryObjectStore.put(`clean-${suffix}`, clean);
    await memoryObjectStore.put(`dup-a-${suffix}`, clean);
    await memoryObjectStore.put(`dup-b-${suffix}`, clean);
    await memoryObjectStore.put(`mismatch-${suffix}`, mismatchBytes);

    await db.insert(crmAttachmentsTable).values([
      {
        inquiryId: inquiry!.id,
        contactId: contact!.id,
        filename: "quote.pdf",
        mimeType: "application/pdf",
        sizeBytes: clean.length,
        storageKey: `clean-${suffix}`,
        sha256: cleanHash,
        malwareStatus: "clean",
      },
      {
        inquiryId: inquiry!.id,
        contactId: contact!.id,
        filename: "note.txt",
        mimeType: "text/plain",
        sizeBytes: clean.length,
        storageKey: `dup-a-${suffix}`,
        sha256: cleanHash,
        malwareStatus: "clean",
      },
      {
        inquiryId: inquiry!.id,
        contactId: contact!.id,
        filename: "note.txt",
        mimeType: "text/plain",
        sizeBytes: clean.length,
        storageKey: `dup-b-${suffix}`,
        sha256: cleanHash,
        malwareStatus: "clean",
      },
      {
        inquiryId: inquiry!.id,
        contactId: contact!.id,
        filename: "virus.bin",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `q-${suffix}`,
        sha256: "deadbeef",
        malwareStatus: "quarantined",
      },
      {
        inquiryId: inquiry!.id,
        contactId: contact!.id,
        filename: "pending.bin",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `p-${suffix}`,
        sha256: "pending",
        malwareStatus: "pending",
      },
      {
        inquiryId: inquiry!.id,
        contactId: contact!.id,
        filename: "missing.bin",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `missing-${suffix}`,
        sha256: "abc",
        malwareStatus: "clean",
      },
      {
        inquiryId: inquiry!.id,
        contactId: contact!.id,
        filename: "badhash.bin",
        mimeType: "application/pdf",
        sizeBytes: mismatchBytes.length,
        storageKey: `mismatch-${suffix}`,
        sha256: cleanHash,
        malwareStatus: "clean",
      },
      {
        inquiryId: inquiry!.id,
        contactId: contact!.id,
        filename: "held.bin",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `hold-${suffix}`,
        sha256: "hold",
        malwareStatus: "clean",
        legalHold: true,
      },
    ]);

    const { server, base } = await listenApp();
    const json = async (path: string, init: RequestInit & { staff?: string }) => {
      const headers = new Headers(init.headers);
      if (init.body) headers.set("content-type", "application/json");
      if (init.staff) headers.set("x-crm-test-staff-id", init.staff);
      const res = await fetch(`${base}${path}`, { ...init, headers });
      const contentType = res.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json") ? await res.json().catch(() => ({})) : await res.text();
      return { status: res.status, body };
    };

    try {
      const denied = await json(`/api/platform/contact/contacts/${contact!.id}/dsar-export`, {
        method: "POST",
        staff: viewer!.id,
      });
      assert.equal(denied.status, 403);

      const accepted = await json(`/api/platform/contact/contacts/${contact!.id}/dsar-export`, {
        method: "POST",
        staff: exporter!.id,
      });
      assert.equal(accepted.status, 202);
      assert.equal(accepted.body.package, undefined);
      const exportId = accepted.body.exportId as string;
      assert.ok(exportId);

      const retry = await json(`/api/platform/contact/contacts/${contact!.id}/dsar-export`, {
        method: "POST",
        staff: exporter!.id,
      });
      assert.equal(retry.body.exportId, exportId);

      const { processExportJob, cancelExport, enqueueDsarExport } = await import("./exportJobs.ts");
      const done = await processExportJob(exportId);
      assert.equal(done.status, "completed");

      const status = await json(`/api/platform/contact/dsar-exports/${exportId}`, {
        method: "GET",
        staff: exporter!.id,
      });
      assert.equal(status.status, 200);
      assert.equal(status.body.status, "ready");
      assert.equal(status.body.package, undefined);
      assert.match(String(status.body.downloadUrl), /\/exports\//);

      const other = await json(`/api/platform/contact/dsar-exports/${exportId}`, {
        method: "GET",
        staff: viewer!.id,
      });
      assert.ok(other.status === 404 || other.status === 403);

      const download = await fetch(`${base}/api/platform/contact/exports/${exportId}/download`, {
        headers: { "x-crm-test-staff-id": exporter!.id },
      });
      assert.equal(download.status, 200);
      const pack = JSON.parse(await download.text()) as {
        attachments: { manifest: Array<{ inclusion: string; filename: string; exportFilename?: string }>; files: Array<{ filename: string; bytesBase64: string }> };
      };
      const inclusions = pack.attachments.manifest.map((m) => m.inclusion);
      assert.ok(inclusions.includes("inline_clean"));
      assert.ok(inclusions.includes("quarantine_manifest_only"));
      assert.ok(inclusions.includes("pending_scan"));
      assert.ok(inclusions.includes("missing_object"));
      assert.ok(inclusions.includes("checksum_mismatch"));
      assert.ok(inclusions.includes("legal_hold_metadata_only"));
      assert.equal(pack.attachments.files.some((f) => f.bytesBase64.includes("virus")), false);
      assert.ok(pack.attachments.manifest.every((m) => m.filename));
      assert.ok(pack.attachments.manifest.some((m) => m.inclusion === "inline_clean" && (m as { mimeType?: string }).mimeType === "application/pdf"));
      const cleanFile = pack.attachments.files.find((f) => f.filename === "quote.pdf");
      assert.ok(cleanFile);
      assert.equal(Buffer.from(cleanFile.bytesBase64, "base64").toString("utf8"), "clean-file-bytes");
      const names = pack.attachments.files.map((f) => f.filename);
      assert.ok(names.includes("note.txt"));
      assert.ok(names.includes("note-1.txt"));
      for (const file of pack.attachments.files) {
        assert.ok(!file.bytesBase64 || Buffer.from(file.bytesBase64, "base64").toString("utf8") !== "tampered");
      }

      const [otherContact] = await db
        .insert(crmContactsTable)
        .values({
          firstName: "Cancel",
          lastName: "Me",
          jobTitle: "Buyer",
          email: `dsar.cancel.${suffix}@example.com`,
          emailNormalized: `dsar.cancel.${suffix}@example.com`,
          country: "US",
        })
        .returning();
      const pendingCancel = await enqueueDsarExport({ staffId: exporter!.id, contactId: otherContact!.id });
      const cancelledJob = await cancelExport({ exportJobId: pendingCancel.id, staffId: exporter!.id });
      assert.equal(cancelledJob.status, "cancelled");

      const { eq } = await import("drizzle-orm");
      const { crmExportJobsTable } = await import("@workspace/db");
      await db
        .update(crmExportJobsTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(crmExportJobsTable.id, exportId));
      const expired = await fetch(`${base}/api/platform/contact/exports/${exportId}/download`, {
        headers: { "x-crm-test-staff-id": exporter!.id },
      });
      assert.equal(expired.status, 410);
    } finally {
      delete process.env.CRM_ALLOW_TEST_JOBS;
      delete process.env.CRM_TEST_DSAR_PROVIDER;
      await closeIsolatedHttpServer(server);
      await rm(exportRoot, { recursive: true, force: true });
    }
  });

  it("withholds provider timeouts, hides partial crash artifacts, and retries failed DSAR jobs", async () => {
    requireIsolatedDb();
    const exportRoot = await mkdtemp(join(tmpdir(), "crm-dsar-crash-"));
    process.env.CRM_EXPORT_FS_ROOT = exportRoot;
    process.env.CRM_ATTACHMENT_STORE = "memory";
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.NODE_ENV = "development";
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmContactsTable, crmInquiriesTable, crmAttachmentsTable } = await import("@workspace/db");
    const { memoryObjectStore } = await import("./attachmentStore.ts");
    const suffix = randomUUID().slice(0, 8);
    const [exporter] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.crash.${suffix}@example.com`,
        emailNormalized: `dsar.crash.${suffix}@example.com`,
        name: "DSAR Crash",
        role: "admin",
        permissions: ["inquiries.export", "inquiries.view"],
      })
      .returning();
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Crash",
        lastName: "Subject",
        jobTitle: "Buyer",
        email: `dsar.crash.sub.${suffix}@example.com`,
        emailNormalized: `dsar.crash.sub.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-2098-T${suffix.slice(0, 5).toUpperCase()}`,
        contactId: contact!.id,
        inquiryType: "sales",
        status: "NEW",
      })
      .returning();
    await memoryObjectStore.put(`to-${suffix}`, Buffer.from("timeout-bytes"));
    await db.insert(crmAttachmentsTable).values({
      inquiryId: inquiry!.id,
      contactId: contact!.id,
      filename: "slow.bin",
      mimeType: "application/pdf",
      sizeBytes: 13,
      storageKey: `to-${suffix}`,
      sha256: "ab",
      malwareStatus: "clean",
    });
    const { enqueueDsarExport, processExportJob, readDownloadBytes, getDownload } = await import("./exportJobs.ts");
    const job = await enqueueDsarExport({ staffId: exporter!.id, contactId: contact!.id });
    process.env.CRM_TEST_DSAR_PROVIDER = "timeout";
    const timed = await processExportJob(job.id);
    assert.equal(timed.status, "completed");
    const dl = await readDownloadBytes({ exportJobId: job.id, staffId: exporter!.id });
    const pack = JSON.parse(dl.bytes.toString("utf8")) as {
      attachments: { manifest: Array<{ inclusion: string }> };
    };
    assert.ok(pack.attachments.manifest.some((m) => m.inclusion === "provider_timeout"));
    delete process.env.CRM_TEST_DSAR_PROVIDER;

    const [contact2] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Partial",
        lastName: "Subject",
        jobTitle: "Buyer",
        email: `dsar.part.${suffix}@example.com`,
        emailNormalized: `dsar.part.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const crashJob = await enqueueDsarExport({ staffId: exporter!.id, contactId: contact2!.id });
    process.env.CRM_TEST_EXPORT_FAIL_AT = "partial_file";
    await assert.rejects(() => processExportJob(crashJob.id));
    await assert.rejects(() => getDownload({ exportJobId: crashJob.id, staffId: exporter!.id }));
    delete process.env.CRM_TEST_EXPORT_FAIL_AT;
    const retried = await processExportJob(crashJob.id);
    assert.equal(retried.status, "completed");
    const ok = await readDownloadBytes({ exportJobId: crashJob.id, staffId: exporter!.id });
    assert.ok(ok.bytes.length > 32);
    delete process.env.CRM_ALLOW_TEST_JOBS;
    await rm(exportRoot, { recursive: true, force: true });
  });
});
