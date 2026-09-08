import { test, expect, chromium } from "@playwright/test";

/**
 * Diagnostic-only. Not part of Waves A–E or qualification matrices.
 * Logs the actual Chromium executable so crash isolation can distinguish
 * bundled headless shell vs Chrome channel.
 */
test.describe("chromium executable identity", () => {
  test("record bundled executable path and version", async ({ browser, browserName, page }) => {
    test.skip(browserName !== "chromium", "chromium-only diagnostic");
    const version = browser.version();
    const exe = chromium.executablePath();
    const proc = browser.process();
    const spawnargs = proc?.spawnargs ?? [];
    await page.goto("/contact");
    const ua = await page.evaluate(() => navigator.userAgent);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        browserName,
        version,
        executablePath: exe,
        spawnargs,
        userAgent: ua,
        variant: process.env.PLAYWRIGHT_CHROMIUM_VARIANT ?? "standard",
      }),
    );
    expect(exe.length).toBeGreaterThan(4);
  });
});
