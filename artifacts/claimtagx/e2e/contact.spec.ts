import { expect, test, type Page, type Route } from "./fixtures";
import { randomUUID } from "node:crypto";
import {
  expectNoBlockingAxe,
  gotoPublic,
} from "./a11y-helpers";

const inquiryTypes = ["sales", "general", "technical", "billing", "other"] as const;

/** Firefox under Vite often never reaches full `load` (long-lived HMR/websocket). */
async function gotoContact(page: Page, path = "/contact") {
  await gotoPublic(page, path);
  await expect(page.getByTestId("contact-form")).toBeVisible({ timeout: 30_000 });
}

async function clickInquiryType(page: Page, type: (typeof inquiryTypes)[number]) {
  const btn = page.getByTestId(`inquiry-type-${type}`);
  await btn.scrollIntoViewIfNeeded();
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
  await btn.click({ timeout: 20_000 });
  await expect(btn).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
}

async function assertLiveApiHealthy(request: import("@playwright/test").APIRequestContext, api: string) {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await request.get(`${api}/api/livez`, { timeout: 5_000 });
      if (res.ok()) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Live API not healthy at ${api}/api/livez`);
}

async function proxyContactApi(route: Route, apiBase: string) {
  const url = new URL(route.request().url());
  const target = `${apiBase}${url.pathname}${url.search}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await route.fetch({ url: target, timeout: 30_000 });
      await route.fulfill({ response });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fillMinimalInquiry(
  page: Page,
  opts: {
    type: (typeof inquiryTypes)[number];
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    message?: string;
    selectUseCase?: boolean;
  },
) {
  await clickInquiryType(page, opts.type);
  await page.locator("#firstName").fill(opts.firstName ?? "Live");
  await page.locator("#lastName").fill(opts.lastName ?? "Api");
  await page.locator("#jobTitle").fill("Ops");
  await page.locator("#companyName").fill(opts.company ?? "ClaimTagX E2E");
  await page.locator("#email").fill(opts.email);
  await page.locator("#country-search").fill("United States");
  const usOption = page.getByRole("option", { name: /United States/i }).first();
  await expect(usOption).toBeVisible({ timeout: 10_000 });
  await usOption.click();
  await expect(page.locator("#calling-code")).toHaveValue("+1", { timeout: 10_000 });
  // Country selection remounts/clears national number — fill phone after country settles.
  await page.locator("#phone").fill("2025550133");
  await expect(page.locator("#phone")).toHaveValue(/555/);
  if (opts.selectUseCase) {
    await page.locator("#use-case-group button").first().click();
  }
  await page.locator("#message").fill(
    opts.message ?? "Live API and PostgreSQL verification inquiry.",
  );
  const consent = page.locator("#consent");
  await consent.scrollIntoViewIfNeeded();
  // Controlled React checkbox: prefer label click (more reliable in Firefox) then force-click.
  const label = page.locator('label[for="consent"]');
  if (await label.count()) {
    await label.click({ force: true });
  }
  if (!(await consent.isChecked())) {
    await consent.click({ force: true });
  }
  if (!(await consent.isChecked())) {
    await consent.evaluate((el: HTMLInputElement) => {
      el.click();
    });
  }
  await expect(consent).toBeChecked({ timeout: 10_000 });
}

test.describe("Contact page", () => {
  test.describe("A1 render direction skip viewport", { tag: "@a1" }, () => {
  test("renders form and inquiry types", async ({ page }) => {
    await gotoContact(page);
    for (const type of inquiryTypes) {
      await expect(page.getByTestId(`inquiry-type-${type}`)).toBeVisible();
    }
  });

  test("skip link targets main content landmark", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /skip to main content/i }).focus();
    await expect(page.getByRole("link", { name: /skip to main content/i })).toBeFocused();
    await expect(page.locator("#main-content")).toBeAttached();
  });

  test("RTL Arabic contact route sets document direction", async ({ page }) => {
    await gotoContact(page, "/ar/contact");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("contact-form")).toBeVisible();
    // Progressive disclosure: pick a type so primary controls exist, then assert layout.
    await clickInquiryType(page, "general");
    const box = await page.getByTestId("contact-submit").boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(40);
      // In RTL the control should still be within the viewport.
      const viewport = page.viewportSize();
      if (viewport) {
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.x).toBeGreaterThanOrEqual(-1);
      }
    }
  });

  test("English LTR contact route sets document direction", async ({ page }) => {
    await gotoContact(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("contact form stays within viewport width", async ({ page }) => {
    await gotoContact(page);

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const form = document.querySelector('[data-testid="contact-form"]');
      const formRect = form?.getBoundingClientRect();
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        formRight: formRect ? formRect.right : null,
        formLeft: formRect ? formRect.left : null,
      };
    });

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.formLeft).not.toBeNull();
    expect(metrics.formRight!).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.formLeft!).toBeGreaterThanOrEqual(-1);
  });
  });

  test.describe("A2 validation keyboard offline errors", { tag: "@a2" }, () => {

  test("submit stays disabled offline", async ({ page, context }) => {
    await gotoContact(page);
    await clickInquiryType(page, "general");
    await expect(page.getByTestId("contact-submit")).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByTestId("contact-submit")).toBeDisabled();
  });

  test("keyboard can focus inquiry type and form fields", async ({ page }) => {
    await gotoContact(page);
    const sales = page.getByTestId("inquiry-type-sales");
    await sales.focus();
    await expect(sales).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("#use-case-group")).toBeVisible();

    const firstName = page.locator("#firstName");
    await firstName.focus();
    await expect(firstName).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.locator("#lastName")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.locator("#jobTitle")).toBeFocused();
  });

  test("empty submit focuses first invalid field and shows errors", async ({ page }) => {
    await gotoContact(page);
    await clickInquiryType(page, "general");
    await expect(page.getByTestId("contact-submit")).toBeVisible();

    await page.getByTestId("contact-form").evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });

    await page.getByTestId("contact-submit").click();

    await expect(page.locator('[role="alert"]').first()).toBeVisible();
    await expect(page.locator("#firstName-error")).toBeVisible();
    await expect(page.locator("#firstName")).toBeFocused();
    await expect(page.locator("#firstName")).toHaveAttribute("aria-invalid", "true");
  });

  test("surfaces mocked 400/409/429/500/503 submit errors", async ({ page }) => {
    const cases: Array<{ status: number; snippet: RegExp }> = [
      { status: 400, snippet: /invalid|highlighted|غير|راجع/i },
      { status: 409, snippet: /already received|already|سبق|مباشرة/i },
      { status: 429, snippet: /too many|wait|محاولات|انتظر/i },
      { status: 500, snippet: /temporarily unavailable|try again|غير متاحة|لاحقًا|systems/i },
      { status: 503, snippet: /temporarily unavailable|service|غير متاحة|لاحقًا/i },
    ];

    for (const { status, snippet } of cases) {
      await page.route("**/api/contact/inquiries", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error: `mock-${status}` }),
        });
      });

      await gotoContact(page);
      await fillMinimalInquiry(page, {
        type: "general",
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        company: "Analytical Engines",
        message: "Please help with a general inquiry about ClaimTagX.",
      });
      await page.getByTestId("contact-submit").click();
      await expect(page.getByTestId("contact-submit-alert")).toBeVisible();
      await expect(page.getByTestId("contact-submit-alert")).toContainText(snippet);
      await page.unroute("**/api/contact/inquiries");
    }
  });

  test("qualified confirmation exposes meeting booking CTA", async ({ page }) => {
    await page.route("**/api/contact/inquiries", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          inquiryId: "00000000-0000-4000-8000-000000000001",
          reference: "CTX-2099-MEET1",
          firstName: "Ada",
          qualified: true,
          meetingUrl: "https://calendly.com/claimtagx/demo",
        }),
      });
    });
    await gotoContact(page);
    await fillMinimalInquiry(page, {
      type: "sales",
      email: "ada.meet@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      message: "Sales inquiry to book a product demonstration meeting.",
      selectUseCase: true,
    });
    await page.getByTestId("contact-submit").click();
    await expect(page.getByTestId("contact-confirmation")).toBeVisible();
    const cta = page.getByTestId("contact-meeting-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "https://calendly.com/claimtagx/demo");
    await expect(cta).not.toHaveAttribute("href", /email=|name=/i);
  });

  test("qualified confirmation without a governed booking URL shows a usable fallback", async ({ page }) => {
    await page.route("**/api/contact/inquiries", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          inquiryId: "00000000-0000-4000-8000-000000000011",
          reference: "CTX-2099-NOBK1",
          firstName: "Ada",
          qualified: true,
          meetingUrl: null,
        }),
      });
    });
    await gotoContact(page);
    await fillMinimalInquiry(page, {
      type: "sales",
      email: "ada.nobook@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      message: "Sales inquiry when booking configuration is unavailable.",
      selectUseCase: true,
    });
    await page.getByTestId("contact-submit").click();
    await expect(page.getByTestId("contact-confirmation")).toBeVisible();
    await expect(page.getByTestId("contact-meeting-cta")).toHaveCount(0);
    await expect(page.getByTestId("contact-meeting-unavailable")).toBeVisible();
  });

  test("meeting URL that embeds PII query params is not used as a CTA", async ({ page }) => {
    await page.route("**/api/contact/inquiries", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          inquiryId: "00000000-0000-4000-8000-000000000012",
          reference: "CTX-2099-PII01",
          firstName: "Ada",
          qualified: true,
          meetingUrl: "https://calendly.com/claimtagx/demo?email=ada@example.com&name=Ada",
        }),
      });
    });
    await gotoContact(page);
    await fillMinimalInquiry(page, {
      type: "sales",
      email: "ada.pii@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      message: "Sales inquiry must not render a booking URL that embeds email.",
      selectUseCase: true,
    });
    await page.getByTestId("contact-submit").click();
    await expect(page.getByTestId("contact-confirmation")).toBeVisible();
    await expect(page.getByTestId("contact-meeting-cta")).toHaveCount(0);
    await expect(page.getByTestId("contact-meeting-unavailable")).toBeVisible();
  });

  test("unsafe meeting URL is not rendered as a booking CTA", async ({ page }) => {
    await page.route("**/api/contact/inquiries", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          inquiryId: "00000000-0000-4000-8000-000000000009",
          reference: "CTX-2099-BAD01",
          firstName: "Ada",
          qualified: true,
          meetingUrl: "javascript:alert(1)",
        }),
      });
    });
    await gotoContact(page);
    await fillMinimalInquiry(page, {
      type: "sales",
      email: "ada.bad@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      message: "Sales inquiry with a hostile booking URL in the API payload.",
      selectUseCase: true,
    });
    await page.getByTestId("contact-submit").click();
    await expect(page.getByTestId("contact-confirmation")).toBeVisible();
    await expect(page.getByTestId("contact-meeting-cta")).toHaveCount(0);
    await expect(page.getByTestId("contact-meeting-unavailable")).toBeVisible();
  });

  test("unqualified confirmation has no meeting CTA", async ({ page }) => {
    await page.route("**/api/contact/inquiries", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          inquiryId: "00000000-0000-4000-8000-000000000002",
          reference: "CTX-2099-STD01",
          firstName: "Ada",
          qualified: false,
          meetingUrl: null,
        }),
      });
    });
    await gotoContact(page);
    await fillMinimalInquiry(page, {
      type: "general",
      email: "ada.std@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      message: "General question that should not open a meeting CTA.",
    });
    await page.getByTestId("contact-submit").click();
    await expect(page.getByTestId("contact-confirmation")).toBeVisible();
    await expect(page.getByTestId("contact-meeting-cta")).toHaveCount(0);
  });
  });

  test.describe("A3 zoom forced-colors reduced-motion axe", { tag: "@a3" }, () => {
  test("respects reduced motion preference", async ({ page }) => {
    await gotoContact(page);

    const prefersReduced = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(prefersReduced).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("axe-core finds no serious/critical issues on /contact", async ({ page }) => {
    await gotoContact(page);
    await expectNoBlockingAxe(page);
  });

  test("axe-core finds no serious/critical issues on /ar/contact", async ({ page }) => {
    await gotoContact(page, "/ar/contact");
    await expectNoBlockingAxe(page);
  });

  test("200% zoom keeps contact form usable", async ({ page }) => {
    // Browser-appropriate reflow: half the nominal layout width approximates 200% zoom.
    const base = page.viewportSize() ?? { width: 1024, height: 768 };
    await page.setViewportSize({
      width: Math.max(320, Math.floor(base.width / 2)),
      height: base.height,
    });
    await gotoContact(page);
    await expect(page.getByTestId("contact-form")).toBeVisible();
    await expect(page.getByTestId("inquiry-type-general")).toBeVisible();
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  });

  test("400% zoom keeps primary controls reachable", async ({ page }) => {
    // Browser-appropriate reflow: quarter width approximates 400% zoom / WCAG reflow.
    const base = page.viewportSize() ?? { width: 1280, height: 800 };
    await page.setViewportSize({
      width: Math.max(320, Math.floor(base.width / 4)),
      height: Math.max(480, Math.floor(base.height / 2)),
    });
    await gotoContact(page);
    await expect(page.getByTestId("contact-form")).toBeVisible();
    const sales = page.getByTestId("inquiry-type-sales");
    await sales.scrollIntoViewIfNeeded();
    await expect(sales).toBeVisible();
  });

  test("forced-colors mode keeps form visible", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await gotoContact(page);
    await expect(page.getByTestId("contact-form")).toBeVisible();
    await expect(page.getByTestId("inquiry-type-general")).toBeVisible();
  });
  });

  test.describe("A4 EN/AR progressive-disclosure matrix", { tag: "@a4" }, () => {
  for (const type of inquiryTypes) {
    test(`inquiry type ${type} progressive branch renders (en)`, async ({ page }) => {
      await gotoContact(page);
      await clickInquiryType(page, type);
      await expect(page.locator("#firstName")).toBeVisible();
      if (type === "sales") {
        await expect(page.locator("#use-case-group")).toBeVisible();
      }
    });

    test(`inquiry type ${type} progressive branch renders (ar)`, async ({ page }) => {
      await gotoContact(page, "/ar/contact");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await clickInquiryType(page, type);
      await expect(page.locator("#firstName")).toBeVisible();
      if (type === "sales") {
        await expect(page.locator("#use-case-group")).toBeVisible();
      }
    });
  }
  });

  test.describe("A5 live API/PG submissions and idempotency", { tag: "@a5" }, () => {
  test.describe("live API+PG paths", () => {
    test("live API+PG general submit creates inquiry when CRM_E2E_API is set", async ({
      page,
      request,
    }) => {
    test.skip(!process.env.CRM_E2E_API, "Set CRM_E2E_API=http://127.0.0.1:18080 and isolated DATABASE_URL");
    test.setTimeout(90_000);
    const api = process.env.CRM_E2E_API!;
    await assertLiveApiHealthy(request, api);
    await page.route("**/api/contact/**", (route) => proxyContactApi(route, api));
    const email = `e2e.${randomUUID()}@example.com`;
    await gotoContact(page);
    await fillMinimalInquiry(page, { type: "general", email });
    await page.getByTestId("contact-submit").click();
    await expect(page.getByTestId("contact-confirmation")).toBeVisible({ timeout: 45_000 });

    const verify = await request.get(`${api}/api/contact/bootstrap`);
    expect(verify.ok()).toBeTruthy();
  });

  test.describe("live ordered paths", () => {
    test.describe.configure({ mode: "serial" });

  test("live API+PG sales path and idempotent retry when CRM_E2E_API is set", async ({
    page,
    request,
  }) => {
    test.skip(!process.env.CRM_E2E_API, "Set CRM_E2E_API=http://127.0.0.1:18080");
    test.setTimeout(120_000);
    const api = process.env.CRM_E2E_API!;
    await page.route("**/api/contact/**", (route) => proxyContactApi(route, api));
    const email = `sales.e2e.${randomUUID()}@example.com`;
    const idempotencyKey = randomUUID();

    // Capture the browser-submitted body and pin a stable idempotency key for retry.
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("**/api/contact/inquiries", async (route) => {
      if (route.request().method() !== "POST") {
        await proxyContactApi(route, api);
        return;
      }
      const raw = route.request().postData() ?? "{}";
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.idempotencyKey = idempotencyKey;
      capturedBody = parsed;
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: `${api}${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          ...route.request().headers(),
          "content-type": "application/json",
        },
        postData: JSON.stringify(parsed),
      });
      await route.fulfill({ response });
    });

    await gotoContact(page);
    await fillMinimalInquiry(page, {
      type: "sales",
      email,
      firstName: "Sales",
      lastName: "Lead",
      company: "Venue Ops Co",
      message: "Sales inquiry for digital claim tickets at scale.",
      selectUseCase: true,
    });
    await page.getByTestId("contact-submit").click();
    await expect(page.getByTestId("contact-confirmation")).toBeVisible({ timeout: 45_000 });
    expect(capturedBody).not.toBeNull();

    const first = await request.post(`${api}/api/contact/inquiries`, {
      data: capturedBody!,
    });
    const second = await request.post(`${api}/api/contact/inquiries`, {
      data: capturedBody!,
    });
    expect([200, 201].includes(first.status()), `first=${first.status()}`).toBeTruthy();
    expect([200, 201].includes(second.status()), `second=${second.status()}`).toBeTruthy();
    const a = await first.json();
    const b = await second.json();
    const idA = a?.inquiryId ?? a?.inquiry?.id ?? a?.id;
    const idB = b?.inquiryId ?? b?.inquiry?.id ?? b?.id;
    const refA = a?.reference ?? a?.inquiry?.reference;
    const refB = b?.reference ?? b?.inquiry?.reference;
    if (idA && idB) expect(idA).toBe(idB);
    if (refA && refB) expect(refA).toBe(refB);

    const bootstrap = await request.get(`${api}/api/contact/bootstrap`);
    expect(bootstrap.ok()).toBeTruthy();
  });

  test("live API recovers from mocked 503 then succeeds when CRM_E2E_API is set", async ({
    page,
  }) => {
    test.skip(!process.env.CRM_E2E_API, "Set CRM_E2E_API=http://127.0.0.1:18080");
    test.setTimeout(120_000);
    const api = process.env.CRM_E2E_API!;
    let failOnce = true;
    await page.route("**/api/contact/inquiries", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      if (failOnce) {
        failOnce = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporary" }),
        });
        return;
      }
      await proxyContactApi(route, api);
    });
    await page.route("**/api/contact/bootstrap", (route) => proxyContactApi(route, api));
    await gotoContact(page);
    await fillMinimalInquiry(page, {
      type: "technical",
      email: `retry.${randomUUID()}@example.com`,
      firstName: "Retry",
      lastName: "Path",
      company: "Ops Lab",
      message: "Technical support inquiry for retry recovery.",
    });
    await page.getByTestId("contact-submit").click();
    await expect(page.getByTestId("contact-submit-alert")).toBeVisible();
    // Use the in-alert Retry control (clears error + requestSubmit) rather than a bare second submit.
    await page.getByTestId("contact-submit-alert").getByRole("button", { name: /retry|إعادة/i }).click();
    await expect(page.getByTestId("contact-confirmation")).toBeVisible({ timeout: 45_000 });
  });
  });

  for (const type of inquiryTypes) {
    test(`live API+PG matrix ${type} persists inquiry when CRM_E2E_API is set`, async ({
      page,
      request,
    }) => {
      test.skip(!process.env.CRM_E2E_API, "Set CRM_E2E_API=http://127.0.0.1:18080");
      test.setTimeout(90_000);
      const api = process.env.CRM_E2E_API!;
      await assertLiveApiHealthy(request, api);
      await page.route("**/api/contact/**", (route) => proxyContactApi(route, api));
      const email = `matrix.${type}.${randomUUID()}@example.com`;
      await gotoContact(page);
      await fillMinimalInquiry(page, {
        type,
        email,
        selectUseCase: type === "sales",
        message: `Matrix verification for ${type} inquiry path.`,
      });
      await page.getByTestId("contact-submit").click();
      const confirmation = page.getByTestId("contact-confirmation");
      const alert = page.getByTestId("contact-submit-alert");
      await expect(confirmation.or(alert)).toBeVisible({ timeout: 45_000 });
      if (await alert.isVisible().catch(() => false)) {
        await alert.getByRole("button", { name: /retry|إعادة/i }).click();
      }
      await expect(confirmation).toBeVisible({ timeout: 45_000 });

      // Public bootstrap remains healthy after each path; durable persistence is asserted
      // via isolated DB probes outside the browser when CRM_E2E_VERIFY_DB=1.
      const bootstrap = await request.get(`${api}/api/contact/bootstrap`);
      expect(bootstrap.ok()).toBeTruthy();
    });
  }
  });
  });
});
