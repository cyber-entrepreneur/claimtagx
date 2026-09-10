import { expect, test, type APIRequestContext } from "./fixtures";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installPlatformAuth } from "./platformAuth";
import { assertAnalyticsCsvFileDownload, waitForHtmlAttribute } from "./a11y-helpers";

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

test.describe("Admin CRM browser matrix", () => {
  test.skip(!process.env.CRM_ADMIN_E2E, "Set CRM_ADMIN_E2E=1 with CRM_E2E_API and verify DATABASE_URL");

  let staff: ReturnType<typeof seedStaff>;

  test.beforeAll(() => {
    staff = seedStaff();
  });

  test("login boundary: unauthenticated /me is rejected", async ({ request }) => {
    let last: unknown;
    for (let i = 0; i < 5; i++) {
      try {
        const res = await request.get(`${apiRoot}/api/platform/me`);
        expect(res.status()).toBe(401);
        return;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  });

  test("roles: admin me has config.manage; analyst API cannot mutate config", async ({
    page,
    request,
  }) => {
    const me = await platformJson(request, "/api/platform/me", staff.admin.id);
    expect(me.status).toBe(200);
    expect(me.body.permissions).toContain("config.manage");

    await installPlatformAuth(page, staff.admin.id);
    await page.goto("/admin/contact/config");
    await waitForHtmlAttribute(page, "data-app-ready", "1");
    await expect(page.getByTestId("admin-config")).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByRole("tab", { name: /change control|templates|taxonomy|sla/i }).first(),
    ).toBeAttached();

    const denied = await platformJson(request, "/api/platform/contact/config/changes", staff.analyst.id, {
      method: "POST",
      data: { entityType: "sla_policy", entityId: crypto.randomUUID(), afterValue: {} },
    });
    expect(denied.status).toBe(403);
  });

  test("forbidden export action: UI hides bulk export without permission; server returns 403", async ({
    page,
    request,
  }) => {
    await installPlatformAuth(page, staff.sales.id);
    await page.goto("/admin/contact");
    await expect(page.getByTestId("admin-inbox")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bulk-export")).toHaveCount(0);

    const denied = await platformJson(request, "/api/platform/contact/exports", staff.analyst.id, {
      method: "POST",
      data: { columns: ["reference"], filters: {} },
    });
    expect(denied.status).toBe(403);
  });

  test("inbox list, search, and saved views load for sales", async ({ page }) => {
    await installPlatformAuth(page, staff.sales.id);
    await page.goto("/admin/contact");
    await expect(page.getByTestId("admin-inbox")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/search/i)).toBeVisible();
    await page.getByLabel(/search/i).fill("CTX-");
    // Narrow viewports may clip the table inside overflow-x containers; attachment is enough.
    await expect(page.getByTestId("inbox-table")).toBeAttached();
    await expect(page.getByTestId("saved-views")).toBeVisible();
    await expect(page.getByTestId("save-view")).toBeVisible();
  });

  test("operations dead-letter panel loads for admin; agent lacks jobs.inspect", async ({
    page,
    request,
  }) => {
    await installPlatformAuth(page, staff.admin.id);
    await page.goto("/admin/contact/operations");
    const ops = page.getByTestId("admin-operations");
    const retry = page.getByRole("button", { name: /retry/i });
    await Promise.race([
      ops.waitFor({ state: "visible", timeout: 25_000 }),
      retry.waitFor({ state: "visible", timeout: 25_000 }),
    ]).catch(() => undefined);
    if (await retry.isVisible().catch(() => false)) {
      await retry.click();
      await page.waitForLoadState("domcontentloaded");
    }
    await expect(ops).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: /operations/i })).toBeAttached();
    await expect(page.getByTestId("dead-letter-panel")).toBeAttached();

    const agentish = await platformJson(request, "/api/platform/contact/jobs/dead", staff.sales.id);
    expect(agentish.status).toBe(403);
  });

  test("marketing CMS route loads for admin", async ({ page }) => {
    await installPlatformAuth(page, staff.admin.id);
    await page.goto("/admin/contact/marketing");
    await expect(page.getByTestId("marketing-cms")).toBeVisible({ timeout: 20_000 });
  });

  test("analytics CSV uses durable export then authorized download", async ({ page }, testInfo) => {
    await installPlatformAuth(page, staff.admin.id);
    await page.goto("/admin/contact/analytics");
    await expect(page.getByTestId("admin-analytics")).toBeVisible({ timeout: 20_000 });
    await assertAnalyticsCsvFileDownload(page, testInfo);
  });
});
