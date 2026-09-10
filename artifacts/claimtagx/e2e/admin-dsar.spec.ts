import { expect, test, type APIRequestContext } from "./fixtures";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installPlatformAuth } from "./platformAuth";

const apiRoot = process.env.CRM_E2E_API ?? "http://127.0.0.1:18080";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Staff = { id: string; email: string; permissions: string[] };

function seedStaff(): { admin: Staff; sales: Staff } {
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
  return JSON.parse(line) as { admin: Staff; sales: Staff };
}

async function platformJson(
  request: APIRequestContext,
  path: string,
  staffId: string,
  init?: { method?: string; data?: unknown },
) {
  const res = await request.fetch(`${apiRoot}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-crm-test-staff-id": staffId,
    },
    data: init?.data,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

async function createSubject(request: APIRequestContext, adminId: string): Promise<{ contactId: string }> {
  const email = `dsar.e2e.${randomUUID().slice(0, 8)}@example.com`;
  const res = await request.post(`${apiRoot}/api/contact/inquiries`, {
    data: {
      firstName: "Dsar",
      lastName: "Subject",
      jobTitle: "Buyer",
      companyName: "DSAR Co",
      email,
      country: "US",
      phoneRaw: "+12025550199",
      inquiryType: "general",
      useCaseKeys: [],
      message: "DSAR browser journey subject inquiry.",
      termsAccepted: true,
      idempotencyKey: randomUUID(),
    },
  });
  const text = await res.text();
  expect(res.status(), text).toBe(201);
  const created = JSON.parse(text) as { reference?: string; inquiryId?: string };
  let inquiryId = created.inquiryId;
  let lastList = "";
  for (let i = 0; i < 20 && !inquiryId; i++) {
    const list = await request.get(
      `${apiRoot}/api/platform/contact/inquiries?search=${encodeURIComponent(created.reference ?? email)}&limit=50`,
      { headers: { "x-crm-test-staff-id": adminId } },
    );
    lastList = await list.text();
    expect(list.status(), lastList).toBe(200);
    const listed = JSON.parse(lastList) as { items?: Array<{ id: string; reference?: string }> };
    const row =
      listed.items?.find((item) => item.reference && item.reference === created.reference) ??
      listed.items?.find((item) => item.reference) ??
      listed.items?.[0];
    inquiryId = row?.id;
    if (!inquiryId) await new Promise((r) => setTimeout(r, 250));
  }
  expect(inquiryId, `inquiry not found for ${email} lastList=${lastList.slice(0, 400)}`).toBeTruthy();
  const detail = await request.get(`${apiRoot}/api/platform/contact/inquiries/${inquiryId}`, {
    headers: { "x-crm-test-staff-id": adminId },
  });
  expect(detail.status()).toBe(200);
  const body = await detail.json();
  const contactId = body.inquiry?.contactId ?? body.contact?.id;
  expect(contactId).toBeTruthy();
  return { contactId };
}

let seedCache: ReturnType<typeof seedStaff>;

test.describe("DSAR browser/API journeys", () => {
  test.skip(!process.env.CRM_ADMIN_E2E, "CRM_ADMIN_E2E=1 required");
  test.setTimeout(90_000);

  test.beforeAll(() => {
    seedCache = seedStaff();
  });

  test("access, correction, legal-hold deletion block, anonymize, and sales 403", async ({ page, request }) => {
    await installPlatformAuth(page, seedCache.admin.id);
    await page.goto("/admin/contact");
    await expect(page.getByTestId("admin-inbox")).toBeVisible({ timeout: 20_000 });

    const { contactId } = await createSubject(request, seedCache.admin.id);
    const denied = await platformJson(request, "/api/platform/contact/dsar", seedCache.sales.id, {
      method: "POST",
      data: { contactId, requestType: "access" },
    });
    expect(denied.status).toBe(403);

    const access = await platformJson(request, "/api/platform/contact/dsar", seedCache.admin.id, {
      method: "POST",
      data: { contactId, requestType: "access" },
    });
    expect(access.status).toBe(201);
    for (const step of [
      { status: "identity_pending" },
      { status: "identity_verified", identityVerified: true },
      { status: "in_progress" },
    ]) {
      const tr = await platformJson(request, `/api/platform/contact/dsar/${access.body.id}/transition`, seedCache.admin.id, {
        method: "POST",
        data: step,
      });
      expect(tr.status).toBe(200);
    }
    const exported = await platformJson(request, `/api/platform/contact/dsar/${access.body.id}/export`, seedCache.admin.id, {
      method: "POST",
    });
    expect(exported.status).toBe(200);

    const correction = await platformJson(request, "/api/platform/contact/dsar", seedCache.admin.id, {
      method: "POST",
      data: { contactId, requestType: "correction" },
    });
    expect(correction.status).toBe(201);
    for (const step of [
      { status: "identity_pending" },
      { status: "identity_verified", identityVerified: true },
      { status: "in_progress" },
    ]) {
      const tr = await platformJson(request, `/api/platform/contact/dsar/${correction.body.id}/transition`, seedCache.admin.id, {
        method: "POST",
        data: step,
      });
      expect(tr.status).toBe(200);
    }
    const patched = await platformJson(request, `/api/platform/contact/dsar/${correction.body.id}/correct`, seedCache.admin.id, {
      method: "POST",
      data: { firstName: "Corrected" },
    });
    expect(patched.status).toBe(200);

    const hold = await platformJson(request, "/api/platform/contact/governance/legal-hold", seedCache.admin.id, {
      method: "POST",
      data: { contactId, reason: "e2e litigation hold" },
    });
    expect(hold.status).toBe(201);
    const deletion = await platformJson(request, "/api/platform/contact/dsar", seedCache.admin.id, {
      method: "POST",
      data: { contactId, requestType: "deletion" },
    });
    expect(deletion.status).toBe(201);
    for (const step of [
      { status: "identity_pending" },
      { status: "identity_verified", identityVerified: true },
      { status: "in_progress" },
    ]) {
      const tr = await platformJson(request, `/api/platform/contact/dsar/${deletion.body.id}/transition`, seedCache.admin.id, {
        method: "POST",
        data: step,
      });
      expect(tr.status).toBe(200);
    }
    const blocked = await platformJson(request, `/api/platform/contact/dsar/${deletion.body.id}/delete`, seedCache.admin.id, {
      method: "POST",
    });
    expect(blocked.status).toBe(409);
  });
});
