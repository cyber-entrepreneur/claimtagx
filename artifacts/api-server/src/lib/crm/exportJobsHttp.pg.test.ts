import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("export HTTP tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
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

async function makeStaff(name: string, permissions: string[]) {
  const { db, crmStaffTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [staff] = await db
    .insert(crmStaffTable)
    .values({
      email: `${name}.${suffix}@example.com`,
      emailNormalized: `${name}.${suffix}@example.com`,
      name,
      role: "admin",
      permissions,
    })
    .returning();
  assert.ok(staff);
  return staff!;
}

describe("export jobs HTTP (CRM_HTTP_TEST_AUTH)", () => {
  it("enqueues via HTTP, processes worker path, and enforces inquiries.export on download", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-http-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    process.env.CRM_ALLOW_TEST_JOBS = "true";

    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmContactsTable, crmInquiriesTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);
    const exporter = await makeStaff("exp-http", ["inquiries.export", "inquiries.view"]);
    const viewer = await makeStaff("exp-view", ["inquiries.view"]);

    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Export",
        lastName: "HTTP",
        jobTitle: "Buyer",
        email: `exp.http.${suffix}@example.com`,
        emailNormalized: `exp.http.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    await db.insert(crmInquiriesTable).values({
      reference: `CTX-2099-X${suffix.slice(0, 5).toUpperCase()}`,
      contactId: contact!.id,
      inquiryType: "sales",
      status: "NEW",
    });

    const { server, base } = await listenApp();
    const json = async (path: string, init: RequestInit & { staff?: string }) => {
      const headers = new Headers(init.headers);
      if (init.body) headers.set("content-type", "application/json");
      if (init.staff) headers.set("x-crm-test-staff-id", init.staff);
      const res = await fetch(`${base}${path}`, { ...init, headers });
      const contentType = res.headers.get("content-type") ?? "";
      const body =
        contentType.includes("application/json") ? await res.json().catch(() => ({})) : await res.text();
      return { status: res.status, body, headers: res.headers };
    };

    try {
      const denied = await json("/api/platform/contact/exports", {
        method: "POST",
        staff: viewer.id,
        body: JSON.stringify({ columns: ["reference"], filters: {} }),
      });
      assert.equal(denied.status, 403);

      const enqueued = await json("/api/platform/contact/exports", {
        method: "POST",
        staff: exporter.id,
        body: JSON.stringify({
          columns: ["reference", "status"],
          filters: { inquiryType: "sales" },
        }),
      });
      assert.equal(enqueued.status, 202);
      const jobId = enqueued.body.job?.id as string;
      assert.ok(jobId);

      const { processExportJob } = await import("./exportJobs.ts");
      const done = await processExportJob(jobId);
      assert.equal(done.status, "completed");

      const list = await json("/api/platform/contact/exports", { method: "GET", staff: exporter.id });
      assert.equal(list.status, 200);
      assert.ok((list.body.jobs as Array<{ id: string }>).some((j) => j.id === jobId));

      const downloadDenied = await json(`/api/platform/contact/exports/${jobId}/download`, {
        method: "GET",
        staff: viewer.id,
      });
      assert.equal(downloadDenied.status, 403);

      const download = await fetch(`${base}/api/platform/contact/exports/${jobId}/download`, {
        headers: { "x-crm-test-staff-id": exporter.id },
      });
      assert.equal(download.status, 200);
      const csv = await download.text();
      assert.match(csv, /reference,status/);
      assert.match(csv, /CTX-2099-X/);
    } finally {
      delete process.env.CRM_ALLOW_TEST_JOBS;
      await closeIsolatedHttpServer(server);
      await rm(root, { recursive: true, force: true });
    }
  });
});
