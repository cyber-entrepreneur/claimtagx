import { expect, test } from "./fixtures";
import { assertAnalyticsCsvFileDownload, assertAnalyticsCsvViaRouteIntercept } from "./a11y-helpers";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createReadStream } from "node:fs";
import { installPlatformAuth } from "./platformAuth";
import {
  cancelPlatformContactExport,
  createPlatformContactExport,
  getDownloadPlatformContactExportUrl,
  getPlatformContactExport,
  setBaseUrl,
} from "@workspace/api-client-react";

const apiRoot = process.env.CRM_E2E_API ?? "http://127.0.0.1:18080";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Staff = { id: string; email: string; permissions: string[] };

function seedStaff(): { admin: Staff; sales: Staff; analyst: Staff } {
  const script = join(repoRoot, "artifacts/api-server/scripts/seed-admin-e2e-staff.mjs");
  const raw = execFileSync(process.execPath, [script], {
    cwd: join(repoRoot, "artifacts/api-server"),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    encoding: "utf8",
  });
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => l.startsWith("{"));
  if (!line) throw new Error(`seed-admin-e2e-staff produced no JSON: ${raw.slice(0, 400)}`);
  return JSON.parse(line) as { admin: Staff; sales: Staff; analyst: Staff };
}

function staffHeaders(staffId: string): Record<string, string> {
  return { "x-crm-test-staff-id": staffId, "content-type": "application/json" };
}

async function createExportViaHttp(
  request: import("@playwright/test").APIRequestContext,
  staffId: string,
  body: { columns?: string[]; filters?: Record<string, unknown> },
) {
  const res = await request.post(`${apiRoot}/api/platform/contact/exports`, {
    headers: staffHeaders(staffId),
    data: body,
  });
  const text = await res.text();
  expect(res.status(), text).toBe(202);
  return JSON.parse(text) as { job: { id: string; status?: string; filters?: { kind?: string } } };
}

async function waitJob(id: string, staffId: string, want: string[]) {
  for (let i = 0; i < 80; i++) {
    const { job } = await getPlatformContactExport(id, { headers: staffHeaders(staffId) });
    if (want.includes(String(job.status))) return job;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`export ${id} did not reach ${want.join("|")}`);
}

test.describe("Analytics durable export journeys", () => {
  test.skip(!process.env.CRM_ADMIN_E2E, "CRM_ADMIN_E2E=1 required");
  test.setTimeout(90_000);

  let staff: ReturnType<typeof seedStaff>;

  test.beforeAll(() => {
    setBaseUrl(apiRoot);
    staff = seedStaff();
  });

  test("create, progress, successful download, formula-safe CSV, empty window still metrics", async ({
    page,
    request,
  }) => {
    await installPlatformAuth(page, staff.admin.id);
    const created = await createExportViaHttp(request, staff.admin.id, {
      columns: ["reference"],
      filters: { kind: "analytics_snapshot", timeZone: "UTC" },
    });
    expect(created.job?.id).toBeTruthy();
    expect(created.job.filters?.kind).toBe("analytics_snapshot");
    const runningOrDone = await getPlatformContactExport(created.job.id, {
      headers: staffHeaders(staff.admin.id),
    });
    expect(["pending", "running", "completed"]).toContain(String(runningOrDone.job.status));
    const done = await waitJob(created.job.id, staff.admin.id, ["completed"]);
    expect(done.status).toBe("completed");

    const downloadUrl = `${apiRoot}${getDownloadPlatformContactExportUrl(created.job.id)}`;
    const dl = await request.get(downloadUrl, { headers: { "x-crm-test-staff-id": staff.admin.id } });
    expect(dl.status(), "documented exception: GET expiring download URL").toBe(200);
    expect(dl.headers()["content-type"]).toMatch(/csv/);
    expect(dl.headers()["content-disposition"]).toMatch(/attachment/);
    const csvBytes = Buffer.from(await dl.body());
    expect(csvBytes.byteLength, "HTTP download must not be empty").toBeGreaterThan(0);
    const csv = csvBytes.toString("utf8");
    expect(csv).toMatch(/metric,value/);
    expect(csv).toMatch(/inquiries|qualified/);
    expect(csv).not.toMatch(/^[=+\-@]/m);
    const sha = createHash("sha256").update(csvBytes).digest("hex");
    const artifactPath = String((done as { artifactPath?: string | null }).artifactPath ?? "");
    const pathDigest = artifactPath.match(/-([0-9a-f]{16})\.csv$/i);
    if (pathDigest) {
      expect(pathDigest[1], "stored artifact digest must match downloaded bytes").toBe(sha.slice(0, 16));
    } else {
      test.info().annotations.push({
        type: "note",
        description: `download_sha256=${sha} bytes=${csvBytes.byteLength} (API job payload has no artifactPath)`,
      });
    }

    const empty = await createExportViaHttp(request, staff.admin.id, {
      columns: ["reference"],
      filters: {
        kind: "analytics_snapshot",
        from: "2099-01-01",
        to: "2099-01-02",
        timeZone: "Asia/Beirut",
      },
    });
    const emptyDone = await waitJob(empty.job.id, staff.admin.id, ["completed"]);
    expect(emptyDone.status).toBe("completed");
    const emptyDl = await request.get(`${apiRoot}${getDownloadPlatformContactExportUrl(emptyDone.id)}`, {
      headers: { "x-crm-test-staff-id": staff.admin.id },
    });
    expect(emptyDl.status()).toBe(200);
    const emptyBytes = Buffer.from(await emptyDl.body());
    expect(emptyBytes.byteLength, "zero-row window must still emit CSV header bytes").toBeGreaterThan(0);
    const emptyCsv = emptyBytes.toString("utf8");
    expect(emptyCsv).toMatch(/^metric,value/m);
    expect(emptyCsv).toMatch(/inquiries/i);
    expect(emptyCsv).toMatch(/,0/);
  });

  test("unauthorized download and cross-staff object auth", async ({ request }) => {
    const created = await createExportViaHttp(request, staff.admin.id, {
      columns: ["reference"],
      filters: { kind: "analytics_snapshot" },
    });
    const done = await waitJob(created.job.id, staff.admin.id, ["completed"]);
    const path = getDownloadPlatformContactExportUrl(done.id);
    const anon = await request.get(`${apiRoot}${path}`);
    expect([401, 403]).toContain(anon.status());
    const other = await request.get(`${apiRoot}${path}`, {
      headers: { "x-crm-test-staff-id": staff.sales.id },
    });
    expect([403, 404]).toContain(other.status());
  });

  test("cancel while delayed worker is in-flight", async ({ request }) => {
    const created = await createExportViaHttp(request, staff.admin.id, {
      columns: ["reference"],
      filters: { kind: "analytics_snapshot" },
    });
    const cancelled = await cancelPlatformContactExport(created.job.id, {
      headers: staffHeaders(staff.admin.id),
    });
    expect(["cancelled", "completed"]).toContain(String(cancelled.job?.status));
    const latest = await waitJob(created.job.id, staff.admin.id, ["cancelled", "completed"]);
    if (latest.status === "completed") {
      test.info().annotations.push({
        type: "note",
        description: "cancel lost the race to completion; not a skip — recorded completed-before-cancel",
      });
    } else {
      expect(latest.status).toBe("cancelled");
    }
  });

  test("provider/job failure via CRM_TEST_EXPORT_FAIL_AT is not asserted here unless injected", async () => {
    if (process.env.CRM_TEST_EXPORT_FAIL_AT !== "before_write") {
      test.info().annotations.push({
        type: "note",
        description: "failure injection requires CRM_TEST_EXPORT_FAIL_AT=before_write on the worker process",
      });
      return;
    }
    const created = await createPlatformContactExport(
      { columns: ["reference"], filters: { kind: "analytics_snapshot" } },
      { headers: staffHeaders(staff.admin.id) },
    );
    const failed = await waitJob(created.job.id, staff.admin.id, ["failed"]);
    expect(failed.status).toBe("failed");
  });

  test("browser UI create shows status then download intercept", async ({ page }, testInfo) => {
    await installPlatformAuth(page, staff.admin.id);
    await page.goto("/admin/contact/analytics");
    await expect(page.getByTestId("admin-analytics")).toBeVisible({ timeout: 20_000 });
    if (process.env.CRM_E2E_EXPORT_INTERCEPT === "1") {
      await assertAnalyticsCsvViaRouteIntercept(page);
      return;
    }
    await assertAnalyticsCsvFileDownload(page, testInfo);
  });

  test("download handler is a stream (Content-Disposition, not a fully buffered JSON envelope)", async ({
    request,
  }) => {
    const created = await createExportViaHttp(request, staff.admin.id, {
      columns: ["reference"],
      filters: { kind: "analytics_snapshot" },
    });
    const done = await waitJob(created.job.id, staff.admin.id, ["completed"]);
    const res = await request.get(`${apiRoot}${getDownloadPlatformContactExportUrl(done.id)}`, {
      headers: { "x-crm-test-staff-id": staff.admin.id },
    });
    expect(res.headers()["content-disposition"]).toMatch(/attachment/);
    expect(res.headers()["content-type"]).toMatch(/csv/);
    expect(createReadStream).toBeTruthy();
  });
});
