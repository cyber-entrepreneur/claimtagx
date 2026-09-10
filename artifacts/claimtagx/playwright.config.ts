import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

/** Qualification evidence must be first-attempt. Diagnostic retries are opt-in. */
const qualification = process.env.PLAYWRIGHT_QUALIFICATION !== "0";
const retries = qualification
  ? 0
  : process.env.PLAYWRIGHT_RETRIES
    ? Number(process.env.PLAYWRIGHT_RETRIES)
    : 0;

/** Chromium-family launch. Qualifying channels: chrome | msedge. Bundled standard/sw are diagnostic. */
function chromiumLaunchOptions(): { channel?: "chrome" | "msedge"; args?: string[] } {
  const variant = process.env.PLAYWRIGHT_CHROMIUM_VARIANT ?? "chrome";
  if (variant === "chrome") {
    return { channel: "chrome" };
  }
  if (variant === "msedge" || variant === "edge") {
    return { channel: "msedge" };
  }
  if (variant === "sw" || variant === "software-gpu") {
    return {
      args: ["--disable-gpu", "--disable-features=CalculateNativeWinOcclusion"],
    };
  }
  return {};
}

const chromiumMobile = {
  browserName: "chromium" as const,
  ...devices["Desktop Chrome"],
  launchOptions: chromiumLaunchOptions(),
};

const firefoxDefault = {
  ...devices["Desktop Firefox"],
};

const firefoxSoftware = {
  ...devices["Desktop Firefox"],
  launchOptions: {
    firefoxUserPrefs: {
      "layers.acceleration.disabled": true,
      "gfx.webrender.software": true,
    },
  },
};

const firefoxEngine = process.env.PLAYWRIGHT_FIREFOX_ENGINE === "software" ? firefoxSoftware : firefoxDefault;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries,
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: process.env.PLAYWRIGHT_TRACE === "1" ? "on" : "off",
    video: process.env.PLAYWRIGHT_TRACE === "1" ? "on" : "off",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "mobile-320",
      use: {
        ...chromiumMobile,
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-390",
      use: {
        ...chromiumMobile,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet-768",
      use: {
        ...chromiumMobile,
        viewport: { width: 768, height: 1024 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop-1024",
      use: {
        ...chromiumMobile,
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "desktop-1440",
      use: {
        ...chromiumMobile,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "firefox-320",
      use: { ...firefoxEngine, viewport: { width: 320, height: 568 } },
    },
    {
      name: "firefox-390",
      use: { ...firefoxEngine, viewport: { width: 390, height: 844 } },
    },
    {
      name: "firefox-768",
      use: { ...firefoxEngine, viewport: { width: 768, height: 1024 } },
    },
    {
      name: "firefox-1024",
      use: { ...firefoxEngine, viewport: { width: 1024, height: 768 } },
    },
    {
      name: "firefox-1440",
      use: {
        ...firefoxEngine,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "webkit-320",
      use: { ...devices["Desktop Safari"], viewport: { width: 320, height: 568 } },
    },
    {
      name: "webkit-390",
      use: { ...devices["Desktop Safari"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "webkit-768",
      use: { ...devices["Desktop Safari"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "webkit-1024",
      use: { ...devices["Desktop Safari"], viewport: { width: 1024, height: 768 } },
    },
    {
      name: "webkit-1440",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "pnpm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          PORT: process.env.PORT ?? "5173",
          BASE_PATH: process.env.BASE_PATH ?? "/",
          npm_config_registry:
            process.env.npm_config_registry ?? "https://registry.npmjs.org",
        },
      },
});
