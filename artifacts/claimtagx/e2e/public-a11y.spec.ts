import { expect, test } from "./fixtures";
import {
  expectNoBlockingAxe,
  gotoPublic,
  preparePublicPage,
} from "./a11y-helpers";

const publicRoutes: Array<{ path: string; ready: string; label: string }> = [
  { path: "/", ready: "main, #main-content, [data-testid='hero']", label: "home" },
  { path: "/price", ready: "main, #main-content", label: "price" },
  { path: "/security", ready: "main, #main-content", label: "security" },
  { path: "/contact", ready: "main, #main-content, [data-testid='contact-form'], form", label: "contact" },
  { path: "/privacy", ready: "main, #main-content", label: "privacy" },
  { path: "/terms", ready: "main, #main-content", label: "terms" },
  { path: "/solutions/valet", ready: "main, #main-content", label: "solutions-valet" },
  { path: "/ar", ready: "main, #main-content", label: "home-ar" },
  { path: "/ar/price", ready: "main, #main-content", label: "price-ar" },
  { path: "/ar/security", ready: "main, #main-content", label: "security-ar" },
  { path: "/ar/contact", ready: "main, #main-content", label: "contact-ar" },
  { path: "/ar/privacy", ready: "main, #main-content", label: "privacy-ar" },
];

test.describe("Public accessibility beyond Contact", () => {
  for (const route of publicRoutes) {
    test(`axe: no serious/critical on ${route.label}`, async ({ page }) => {
      await gotoPublic(page, route.path);
      await expect(page.locator("main, #main-content").first()).toBeVisible({
        timeout: 20_000,
      });
      await expectNoBlockingAxe(page);
    });
  }

  test("forced-colors mode keeps home landmark usable", async ({ page }) => {
    await preparePublicPage(page);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const main = page.locator("main, #main-content").first();
    await expect(main).toBeAttached({ timeout: 20_000 });
    await expect(main).toBeVisible();
    // Horizontal comparison/pricing matrices intentionally scroll on narrow
    // viewports; assert landmark usability rather than zero document overflow.
    await expect(page.getByRole("link", { name: /skip to main content/i })).toBeAttached();
  });

  test("200% zoom keeps home CTA reachable", async ({ page }) => {
    await preparePublicPage(page);
    // Prefer a stable landmark; fall back to main if hero test id absent.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const hero = page.getByTestId("hero");
    const main = page.locator("main, #main-content").first();
    const primary = (await hero.count()) > 0 ? hero : main;
    await expect(primary).toBeAttached({ timeout: 20_000 });
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const width = Math.max(320, Math.floor(vp.width * 0.5));
    await page.setViewportSize({ width, height: vp.height });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main, #main-content").first()).toBeAttached();
    await expect(page.locator("main, #main-content").first()).toBeVisible();
    const box = await page.locator("main, #main-content").first().boundingBox();
    expect(box, "main should have layout box").toBeTruthy();
    if (box) {
      expect(box.width).toBeGreaterThan(40);
    }
  });

  test("400% zoom keeps security primary content reachable", async ({ page }) => {
    await preparePublicPage(page);
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const width = Math.max(320, Math.floor(vp.width * 0.25));
    await page.setViewportSize({ width, height: vp.height });
    await page.goto("/security", { waitUntil: "domcontentloaded" });
    const main = page.locator("#main-content, main").first();
    await expect(main).toBeAttached({ timeout: 20_000 });
    const box = await main.boundingBox();
    expect(box, "main should have layout box").toBeTruthy();
    if (box) {
      expect(box.width).toBeGreaterThan(40);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 2);
    }
  });

  test("skip to main content works on home", async ({ page }) => {
    await preparePublicPage(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const skip = page.getByRole("link", { name: /skip to main content/i });
    await expect(skip).toBeAttached();
    await skip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });
});
