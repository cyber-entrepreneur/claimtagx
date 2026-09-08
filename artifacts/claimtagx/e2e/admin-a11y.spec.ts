import { expect, test, type Page } from "./fixtures";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertReflowUsable, expectNoBlockingAxe, preparePublicPage, waitForHtmlAttribute } from "./a11y-helpers";
import { installPlatformAuth } from "./platformAuth";

const apiRoot = process.env.CRM_E2E_API ?? "http://127.0.0.1:18080";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Staff = { id: string; email: string; permissions: string[] };

function seedStaff(): { admin: Staff } {
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
  return JSON.parse(line) as { admin: Staff };
}

async function gotoAdmin(page: Page, path: string, testId: string) {
  await preparePublicPage(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForHtmlAttribute(page, "data-app-ready", "1");
  await expect(page.getByTestId(testId)).toBeAttached({ timeout: 25_000 });
}

test.describe("Admin accessibility engineering", () => {
  test.skip(!process.env.CRM_ADMIN_E2E, "Set CRM_ADMIN_E2E=1 with CRM_E2E_API and verify DATABASE_URL");

  let staff: ReturnType<typeof seedStaff>;

  test.beforeAll(() => {
    staff = seedStaff();
  });

  const routes: Array<{ path: string; testId: string; label: string }> = [
    { path: "/admin/contact", testId: "admin-inbox", label: "inbox" },
    { path: "/admin/contact/analytics", testId: "admin-analytics", label: "analytics" },
    { path: "/admin/contact/config", testId: "admin-config", label: "config" },
    { path: "/admin/contact/operations", testId: "admin-operations", label: "operations" },
    { path: "/admin/contact/marketing", testId: "marketing-cms", label: "marketing" },
    { path: "/admin/contact/attachments", testId: "admin-attachments", label: "attachments" },
  ];

  for (const route of routes) {
    test(`axe: no serious/critical on ${route.label}`, async ({ page }) => {
      await installPlatformAuth(page, staff.admin.id);
      await gotoAdmin(page, route.path, route.testId);
      await expect(page.locator("#admin-main")).toBeAttached();
      await expectNoBlockingAxe(page, "#admin-main");
    });
  }

  test("config tabs are keyboard operable", async ({ page }) => {
    await installPlatformAuth(page, staff.admin.id);
    await gotoAdmin(page, "/admin/contact/config", "admin-config");
    const tablist = page.getByRole("tablist", { name: /configuration sections/i });
    await expect(tablist).toBeVisible();
    const first = tablist.getByRole("tab").first();
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("ArrowRight");
    const selected = tablist.locator('[role="tab"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
  });

  test("analytics breakdowns expose table semantics", async ({ page }) => {
    await installPlatformAuth(page, staff.admin.id);
    await gotoAdmin(page, "/admin/contact/analytics", "admin-analytics");
    await expect(page.getByRole("heading", { name: /contact analytics/i })).toBeVisible();
    // Empty or populated: captioned tables when rows exist; otherwise "No data yet."
    const tables = page.locator("table");
    const empty = page.getByText(/no data yet/i);
    await expect(tables.or(empty).first()).toBeAttached();
  });

  test("200% zoom keeps inbox primary controls reachable", async ({ page }) => {
    await installPlatformAuth(page, staff.admin.id);
    await preparePublicPage(page);
    await assertReflowUsable(page, {
      path: "/admin/contact",
      primaryTestId: "admin-inbox",
      fraction: 0.5,
    });
  });

  test("400% zoom keeps analytics reachable", async ({ page }) => {
    await installPlatformAuth(page, staff.admin.id);
    await preparePublicPage(page);
    await assertReflowUsable(page, {
      path: "/admin/contact/analytics",
      primaryTestId: "admin-analytics",
      fraction: 0.25,
    });
  });

  test("skip link targets admin main", async ({ page }) => {
    await installPlatformAuth(page, staff.admin.id);
    await preparePublicPage(page);
    await page.goto("/admin/contact", { waitUntil: "domcontentloaded" });
    const skip = page.getByRole("link", { name: /skip to workspace content/i });
    await expect(skip).toBeAttached();
    await skip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#admin-main")).toBeFocused();
  });
});
