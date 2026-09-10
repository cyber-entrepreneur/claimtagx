import { expect, test, type APIRequestContext } from "./fixtures";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installPlatformAuth } from "./platformAuth";

const apiRoot = process.env.CRM_E2E_API ?? "http://127.0.0.1:18080";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Staff = { id: string; email: string; permissions: string[] };

function seedStaff(): {
  admin: Staff;
  cmsAuthor: Staff;
  cmsReviewer: Staff;
  cmsPublisher: Staff;
} {
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
  return JSON.parse(line);
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

test.describe("CMS governance browser journeys", () => {
  test.skip(!process.env.CRM_ADMIN_E2E, "CRM_ADMIN_E2E=1 required");
  test.setTimeout(90_000);

  let staff: ReturnType<typeof seedStaff>;

  test.beforeAll(() => {
    staff = seedStaff();
  });

  test("draft, second-person reject/approve, author cannot self-approve, UI loads", async ({ page, request }) => {
    const slug = `cms-e2e-${Date.now().toString(36)}`;
    await installPlatformAuth(page, staff.cmsAuthor.id);
    await page.goto("/admin/contact/marketing");
    await expect(page.getByTestId("marketing-cms")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("cms-draft-slug").fill(slug);
    await page.getByTestId("cms-draft-title").fill("CMS E2E Draft");
    await page.getByTestId("cms-create-draft").click();
    await expect(page.getByTestId(`cms-doc-${slug}`)).toBeVisible({ timeout: 20_000 });

    const created = await platformJson(request, "/api/platform/marketing/documents", staff.cmsAuthor.id, {
      method: "POST",
      data: {
        slug: `${slug}-api`,
        locale: "en",
        title: "CMS API Draft",
        summary: "s",
        seoTitle: "SEO",
        seoDescription: "Desc",
        body: { hero: "ok" },
      },
    });
    expect(created.status).toBe(201);
    const versionId = created.body.version.id as string;
    let lock = created.body.version.lockVersion as number;

    const submitted = await platformJson(
      request,
      `/api/platform/marketing/versions/${versionId}/transition`,
      staff.cmsAuthor.id,
      { method: "POST", data: { transition: "submit_review", expectedLockVersion: lock } },
    );
    expect(submitted.status).toBe(200);
    lock = submitted.body.version.lockVersion;

    const selfApprove = await platformJson(
      request,
      `/api/platform/marketing/versions/${versionId}/transition`,
      staff.cmsAuthor.id,
      { method: "POST", data: { transition: "approve", expectedLockVersion: lock } },
    );
    expect(selfApprove.status).toBe(403);

    const rejected = await platformJson(
      request,
      `/api/platform/marketing/versions/${versionId}/transition`,
      staff.cmsReviewer.id,
      { method: "POST", data: { transition: "reject", expectedLockVersion: lock, reason: "rewrite copy" } },
    );
    expect(rejected.status).toBe(200);

    const v2 = await platformJson(request, "/api/platform/marketing/documents", staff.cmsAuthor.id, {
      method: "POST",
      data: {
        slug: `${slug}-api`,
        locale: "en",
        title: "CMS API Draft 2",
        summary: "s",
        seoTitle: "SEO 2",
        seoDescription: "Desc 2",
        body: { hero: "ok2" },
      },
    });
    expect(v2.status).toBe(201);
    const id2 = v2.body.version.id as string;
    let lock2 = v2.body.version.lockVersion as number;
    const submitted2 = await platformJson(
      request,
      `/api/platform/marketing/versions/${id2}/transition`,
      staff.cmsAuthor.id,
      { method: "POST", data: { transition: "submit_review", expectedLockVersion: lock2 } },
    );
    expect(submitted2.status).toBe(200);
    lock2 = submitted2.body.version.lockVersion;
    const approved = await platformJson(
      request,
      `/api/platform/marketing/versions/${id2}/transition`,
      staff.cmsReviewer.id,
      { method: "POST", data: { transition: "approve", expectedLockVersion: lock2 } },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.version.status).toBe("approved");

    const published = await platformJson(
      request,
      `/api/platform/marketing/versions/${id2}/transition`,
      staff.cmsPublisher.id,
      { method: "POST", data: { transition: "publish", expectedLockVersion: approved.body.version.lockVersion } },
    );
    expect(published.status).toBe(200);
  });
});
