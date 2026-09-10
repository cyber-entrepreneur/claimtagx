import { expect, test, type Page } from "./fixtures";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagStamp, gotoPublic, screenshotBounded } from "./a11y-helpers";

/**
 * Public Arabic RTL layout matrix (local isolated).
 * Asserts direction, overflow, landmarks, and a viewport screenshot per route.
 * Does not claim qualified Arabic legal-copy approval.
 *
 * AR_SECURITY_DIAG=A|B|C|D limits to /ar/security for isolated diagnostics (not qualification).
 */

const seo = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "content", "seo", "routes.json"),
    "utf8",
  ),
) as { routes: Array<{ path: string }> };

const ARABIC_ROUTES = seo.routes.map((r) => (r.path === "/" ? "/ar" : `/ar${r.path}`));
const diagMode = (process.env.AR_SECURITY_DIAG ?? "").trim().toUpperCase();
const ROUTES = diagMode ? (["/ar/security"] as const) : ARABIC_ROUTES;

async function gotoArabic(page: Page, path: string) {
  await gotoPublic(page, path);
  await expect(page.locator("main, [role='main'], #main-content").first()).toBeVisible({
    timeout: 20_000,
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      clientWidth: doc.clientWidth,
      scrollWidth: Math.max(doc.scrollWidth, body?.scrollWidth ?? 0),
      dir: doc.getAttribute("dir"),
      lang: doc.getAttribute("lang"),
    };
  });
  expect(metrics.dir, JSON.stringify(metrics)).toBe("rtl");
  expect(metrics.lang === "ar" || (metrics.lang ?? "").startsWith("ar"), JSON.stringify(metrics)).toBeTruthy();
  // Allow 1px subpixel slack on WebKit/Firefox.
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function assertNavMirrored(page: Page) {
  const nav = page.locator("header nav, nav[aria-label], aside[aria-label]").first();
  if ((await nav.count()) === 0) return;
  const box = await nav.boundingBox();
  if (!box) return;
  const vw = page.viewportSize()?.width ?? 0;
  // In RTL, primary nav cluster should not be pinned exclusively to the physical left third on desktop.
  if (vw >= 1024) {
    expect(box.x + box.width / 2).toBeGreaterThan(vw * 0.2);
  }
}

test.describe("Arabic public RTL matrix", () => {
  test.setTimeout(90_000);
  test.afterEach(async ({}, testInfo) => {
    diagStamp("teardown_end", { status: testInfo.status, mode: diagMode || "full" });
  });

  for (const path of ROUTES) {
    test(`${path}: rtl, no clip overflow, landmark, screenshot`, async ({ page, browser }, testInfo) => {
      diagStamp("test_start", {
        path,
        mode: diagMode || "full",
        browserName: browser.browserType().name(),
        version: browser.version(),
        pid: (() => {
          const b = page.context().browser() as { process?: () => { pid?: number } } | null;
          try {
            return b?.process?.()?.pid ?? null;
          } catch {
            return null;
          }
        })(),
      });

      if (diagMode === "B") {
        await gotoArabic(page, path);
        const main = page.locator("main, [role='main'], #main-content").first();
        const body = await screenshotBounded(main, page, 15_000);
        await testInfo.attach(`ar-${path.replace(/[^\w]+/g, "_")}`, { body, contentType: "image/png" });
        return;
      }

      await gotoArabic(page, path);
      diagStamp("overflow_start");
      await assertNoHorizontalOverflow(page);
      await assertNavMirrored(page);
      const main = page.locator("main, [role='main'], #main-content").first();
      await expect(main).toBeVisible();
      diagStamp("overflow_end");

      if (diagMode === "A") {
        await testInfo.attach("route", { body: path, contentType: "text/plain" });
        return;
      }

      const shotName = `ar-${path.replace(/[^\w]+/g, "_") || "home"}`;
      const png = await screenshotBounded(main, page, 15_000);
      await testInfo.attach(shotName, { body: png, contentType: "image/png" });
      await testInfo.attach("route", { body: path, contentType: "text/plain" });
    });
  }
});
