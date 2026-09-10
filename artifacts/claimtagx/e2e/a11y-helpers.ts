import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const axeSource = readFileSync(axePath, "utf8");
const axeSha = createHash("sha256").update(axeSource).digest("hex").slice(0, 16);

export class AxeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AxeUnavailableError";
  }
}

export async function installE2eStability(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    document.documentElement.dataset.e2eStable = "1";
    try {
      localStorage.setItem("claimtagx-cookie-consent", "accepted");
    } catch {
      /* ignore */
    }
  });
}

export async function preparePublicPage(page: Page) {
  await installE2eStability(page);
}

/**
 * Read html attributes via getAttribute. Playwright Firefox toHaveAttribute on
 * <html> builds a full ARIA snapshot and can crash (HTMLTextAreaElement prototype)
 * before data-app-ready is set. Same 15s budget; same required values.
 */
export async function waitForHtmlAttribute(
  page: Page,
  name: string,
  expected: string | RegExp,
  timeout = 15_000,
) {
  if (expected instanceof RegExp) {
    await expect
      .poll(async () => {
        if (page.isClosed()) {
          throw new Error(`page closed while waiting for html[${name}]`);
        }
        return (await page.locator("html").getAttribute(name)) ?? "";
      }, { timeout })
      .toMatch(expected);
    return;
  }
  await expect
    .poll(async () => {
      if (page.isClosed()) {
        throw new Error(`page closed while waiting for html[${name}]`);
      }
      return page.locator("html").getAttribute(name);
    }, { timeout })
    .toBe(expected);
}

export async function waitForDocumentLocale(page: Page, locale: "en" | "ar") {
  await waitForHtmlAttribute(page, "data-locale", locale);
  await waitForHtmlAttribute(page, "lang", locale === "ar" ? /^ar/ : /^en/);
  await waitForHtmlAttribute(page, "dir", locale === "ar" ? "rtl" : "ltr");
  await waitForHtmlAttribute(page, "data-app-ready", "1");
}

export function diagStamp(stage: string, extra?: Record<string, unknown>) {
  const rec = { t: Date.now(), monoMs: Number(performance.now().toFixed(1)), stage, ...extra };
  const line = JSON.stringify(rec);
  // eslint-disable-next-line no-console
  console.log(`AR_DIAG ${line}`);
  const dest = process.env.AR_DIAG_LOG;
  if (dest) {
    try {
      appendFileSync(dest, `${line}\n`);
    } catch {
      /* ignore */
    }
  }
}

/** Close only this test's Playwright browser; never scan/kill unrelated PIDs. */
async function closeOwnedBrowser(page: Page, reason: string) {
  diagStamp("owned_browser_close_start", { reason });
  const browser = page.context().browser() as
    | { process?: () => { pid?: number; killed?: boolean; kill?: () => void }; close?: () => Promise<void> }
    | null;
  const proc = typeof browser?.process === "function" ? browser.process() : undefined;
  const pid = proc?.pid;
  try {
    await Promise.race([
      page.context().close(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("context.close exceeded 5000ms")), 5_000);
      }),
    ]);
  } catch (err) {
    diagStamp("owned_context_close_error", { reason, err: String(err), pid });
    if (proc && pid && !proc.killed && typeof proc.kill === "function") {
      proc.kill();
      diagStamp("owned_browser_proc_kill", { pid, reason });
    }
  }
  try {
    await Promise.race([
      browser?.close?.() ?? Promise.resolve(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("browser.close exceeded 5000ms")), 5_000);
      }),
    ]);
  } catch (err) {
    diagStamp("owned_browser_close_error", { reason, err: String(err), pid });
    if (proc && pid && !proc.killed && typeof proc.kill === "function") {
      proc.kill();
      diagStamp("owned_browser_proc_kill", { pid, reason });
    }
  }
  diagStamp("owned_browser_close_end", { reason, pid });
}

export async function withBound<T>(label: string, ms: number, page: Page, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      void closeOwnedBrowser(page, `watchdog:${label}`).finally(() => {
        reject(new Error(`${label} exceeded ${ms}ms; owned browser closed`));
      });
    }, ms);
  });
  try {
    return await Promise.race([work, watchdog]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function screenshotBounded(locator: Locator, page: Page, timeoutMs = 15_000) {
  diagStamp("screenshot_start", { timeoutMs });
  await expect(locator).toBeVisible({ timeout: timeoutMs });
  const vp = page.viewportSize();
  if (!vp) {
    throw new Error("screenshotBounded requires a viewport size");
  }
  // Viewport clip only: Arabic `main` can exceed WebKit's 32767px screenshot cap.
  const body = await withBound(
    "page.screenshot",
    timeoutMs + 3_000,
    page,
    page.screenshot({
      animations: "disabled",
      caret: "hide",
      timeout: timeoutMs,
      clip: { x: 0, y: 0, width: vp.width, height: vp.height },
    }),
  );
  diagStamp("screenshot_end", { bytes: body.byteLength, width: vp.width, height: vp.height });
  return body;
}

export async function gotoPublic(page: Page, path: string) {
  await preparePublicPage(page);
  diagStamp("goto_start", { path });
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  diagStamp("goto_domcontentloaded", { path });
  const locale = path === "/ar" || path.startsWith("/ar/") ? "ar" : "en";
  await waitForDocumentLocale(page, locale);
  diagStamp("app_ready", { path, locale });
  await expect(page.locator("main, #main-content, [data-testid='contact-form']").first()).toBeAttached({
    timeout: 20_000,
  });
  diagStamp("fonts_ready_start");
  const fontsOutcome = await Promise.race([
    page.evaluate(() => document.fonts.ready.then(() => "ready" as const)),
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 8_000);
    }),
  ]).catch(() => "error" as const);
  diagStamp("fonts_ready_end", { fontsOutcome });
  const fab = page.getByTestId("contact-fab");
  if ((await fab.count()) > 0) {
    await expect(fab).toHaveCSS("opacity", "1", { timeout: 10_000 });
    diagStamp("fab_opacity_ready");
  }
}

async function ensureAxe(page: Page) {
  if (page.isClosed()) throw new AxeUnavailableError("axe page closed");
  const ready = await page.evaluate(() => {
    const w = window as unknown as { axe?: { run?: unknown; version?: string } };
    return typeof w.axe?.run === "function";
  });
  if (!ready) {
    await page.addScriptTag({ path: axePath });
  }
  const info = await page.evaluate((sha) => {
    const w = window as unknown as { axe?: { run?: unknown; version?: string }; __AXE_SHA?: string };
    if (typeof w.axe?.run === "function") {
      w.__AXE_SHA = sha;
      return { ok: true, version: w.axe.version ?? "unknown", sha };
    }
    return { ok: false, version: "", sha };
  }, axeSha);
  if (!info.ok) {
    throw new AxeUnavailableError(`axe injection failed (sha ${axeSha})`);
  }
}

export async function runAxe(page: Page, rootSelector?: string) {
  await ensureAxe(page);
  try {
    return await page.evaluate(async (sel) => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              ctx: unknown,
              opts: unknown,
            ) => Promise<{
              violations: Array<{
                id: string;
                impact?: string | null;
                help: string;
                nodes: Array<{ target: string[]; html: string }>;
              }>;
            }>;
          };
        }
      ).axe;
      const root =
        (sel ? document.querySelector(sel) : null) ??
        document.querySelector("main") ??
        document.querySelector("#admin-main") ??
        document.querySelector("#main-content") ??
        document.documentElement;
      const context = {
        include: [root as Element],
        exclude: [["canvas[aria-hidden='true']"]],
      };
      const results = await axe.run(context, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      });
      return results.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 8).map((n) => n.target.join(" ")),
      }));
    }, rootSelector ?? null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/closed|crashed|destroyed|Target/i.test(msg)) {
      throw new AxeUnavailableError(msg);
    }
    throw err;
  }
}

export async function expectNoBlockingAxe(page: Page, rootSelector?: string) {
  const blocking = (await runAxe(page, rootSelector)).filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

export async function assertReflowUsable(
  page: Page,
  opts: { path: string; primaryTestId: string; fraction: 0.5 | 0.25 },
) {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const width = Math.max(320, Math.floor(vp.width * opts.fraction));
  await page.setViewportSize({ width, height: vp.height });
  await page.goto(opts.path, { waitUntil: "domcontentloaded" });
  const primary = page.getByTestId(opts.primaryTestId);
  await expect(primary).toBeAttached({ timeout: 20_000 });
  const box = await primary.boundingBox();
  expect(box, "primary control should have layout box").toBeTruthy();
  if (box) {
    expect(box.width).toBeGreaterThan(40);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 2);
  }
}

/** Diagnostic-only: Firefox often yields an empty body for streamed attachment intercepts. */
export async function assertAnalyticsCsvViaRouteIntercept(page: Page) {
  let downloadStatus: number | null = null;
  let downloadBody = "";
  let contentType = "";
  let contentDisposition = "";
  let contentLength = "";
  await page.route("**/api/platform/contact/exports/**/download", async (route) => {
    const res = await route.fetch();
    downloadStatus = res.status();
    contentType = res.headers()["content-type"] ?? "";
    contentDisposition = res.headers()["content-disposition"] ?? "";
    contentLength = res.headers()["content-length"] ?? "";
    downloadBody = await res.text();
    await route.fulfill({
      status: res.status(),
      headers: {
        "content-type": contentType || "text/csv; charset=utf-8",
        "content-disposition": contentDisposition || 'attachment; filename="export.csv"',
      },
      body: downloadBody,
    });
  });
  await page.getByTestId("analytics-export-csv").click();
  await expect(page.getByTestId("analytics-export-status")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => downloadStatus, { timeout: 40_000 }).toBe(200);
  diagStamp("export_intercept", {
    status: downloadStatus,
    bodyBytes: downloadBody.length,
    contentType,
    contentDisposition,
    contentLength,
  });
  expect(downloadBody.length, "intercept body must not be empty").toBeGreaterThan(0);
  expect(downloadBody).toMatch(/inquiries|qualified|metric/i);
}

export async function assertAnalyticsCsvFileDownload(page: Page, testInfo: TestInfo) {
  const downloadPromise = page.waitForEvent("download", { timeout: 40_000 });
  await page.getByTestId("analytics-export-csv").click();
  await expect(page.getByTestId("analytics-export-status")).toBeVisible({ timeout: 15_000 });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/analytics-export-.+\.csv/);
  const dest = join(
    tmpdir(),
    `crm-e2e-dl-${process.env.CRM_E2E_RUN_ID ?? "local"}-${Date.now()}.csv`,
  );
  await download.saveAs(dest);
  try {
    const bytes = readFileSync(dest);
    expect(bytes.byteLength, "downloaded CSV must be non-empty").toBeGreaterThan(0);
    const text = bytes.toString("utf8");
    expect(text).toMatch(/metric,value/);
    expect(text).toMatch(/inquiries|qualified|metric/i);
    const sha = createHash("sha256").update(bytes).digest("hex");
    diagStamp("export_download_file", { bytes: bytes.byteLength, sha256: sha, file: dest });
    testInfo.annotations.push({
      type: "note",
      description: `csv_bytes=${bytes.byteLength} sha256=${sha}`,
    });
  } finally {
    try {
      unlinkSync(dest);
    } catch {
      /* owned temp already gone */
    }
  }
}
