import { expect, type Page } from "@playwright/test";
import { installE2eStability } from "./a11y-helpers";

const apiRoot = process.env.CRM_E2E_API ?? "http://127.0.0.1:18080";

export async function assertApiAlive(page: Page) {
  try {
    const live = await page.request.get(`${apiRoot}/api/livez`, { timeout: 3_000 });
    const ready = await page.request.get(`${apiRoot}/api/readyz`, { timeout: 3_000 });
    if (!live.ok() || !ready.ok()) {
      throw new Error(`API_DEAD live=${live.status()} ready=${ready.status()}`);
    }
  } catch (err) {
    throw new Error(`API_DEAD ${apiRoot}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function installPlatformAuth(page: Page, staffId: string) {
  await installE2eStability(page);
  await assertApiAlive(page);
  const siteOrigin = (process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
  await page.context().clearCookies();
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const login = await page.request.post(`${apiRoot}/api/platform/auth/test-login`, {
        data: { staffId },
        headers: { origin: siteOrigin, referer: `${siteOrigin}/admin/contact` },
      });
      expect(login.ok(), `test-login ${login.status()} ${await login.text()}`).toBeTruthy();
      const raw = login.headers()["set-cookie"];
      const cookieHeader = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
      const match = /ctx_platform_session=([^;]+)/.exec(cookieHeader);
      expect(match, `session cookie missing from: ${cookieHeader}`).toBeTruthy();
      await page.context().addCookies([
        {
          name: "ctx_platform_session",
          value: decodeURIComponent(match![1]),
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      return;
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/API_DEAD|ECONNREFUSED/i.test(msg)) throw err instanceof Error ? err : new Error(msg);
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
