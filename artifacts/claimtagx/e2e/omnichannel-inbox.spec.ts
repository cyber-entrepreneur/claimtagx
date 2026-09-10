import { expect, test, type Page } from "./fixtures";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installPlatformAuth } from "./platformAuth";

const apiRoot = process.env.CRM_E2E_API ?? "http://127.0.0.1:18181";
const siteOrigin = (process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:15173").replace(/\/$/, "");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type OmniStaff = {
  admin: { id: string; email: string };
  auditor: { id: string; email: string };
  agentA: { id: string; email: string };
  foreignInquiryId: string;
  tiktokInquiryId: string;
};

function seedOmni(): OmniStaff {
  const script = join(repoRoot, "artifacts/api-server/scripts/seed-omni-inbox-staff.mts");
  const tsx = join(repoRoot, "node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs");
  const raw = execFileSync(process.execPath, [tsx, script], {
    cwd: join(repoRoot, "artifacts/api-server"),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    encoding: "utf8",
  });
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => l.startsWith("{"));
  if (!line) throw new Error(`seed-omni-inbox-staff produced no JSON: ${raw.slice(0, 400)}`);
  return JSON.parse(line) as OmniStaff;
}

async function proxyApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const target = `${apiRoot}${url.pathname}${url.search}`;
    try {
      const response = await route.fetch({ url: target, timeout: 30_000 });
      await route.fulfill({ response });
    } catch {
      await route.continue();
    }
  });
}

async function fillGeneralContact(page: Page, email: string, firstName: string) {
  await page.goto("/contact", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByTestId("contact-form")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("inquiry-type-general").click();
  await page.locator("#firstName").fill(firstName);
  await page.locator("#lastName").fill("Omni");
  await page.locator("#jobTitle").fill("Ops");
  await page.locator("#companyName").fill("ClaimTagX Omni");
  await page.locator("#email").fill(email);
  await page.locator("#country-search").fill("United States");
  const usOption = page.getByRole("option", { name: /United States/i }).first();
  await expect(usOption).toBeVisible({ timeout: 10_000 });
  await usOption.click();
  await page.locator("#phone").fill("2025550133");
  await page.locator("#message").fill("Omnichannel inbox qualification inquiry body.");
  const consent = page.locator("#consent");
  await consent.scrollIntoViewIfNeeded();
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
  if (!(await consent.isChecked())) {
    await consent.evaluate((el: HTMLInputElement) => {
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked");
      desc?.set?.call(el, true);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await expect(consent).toBeChecked({ timeout: 10_000 });
  await page.getByTestId("contact-submit").click();
}

function metaSig(secret: string, raw: string) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function xSig(secret: string, raw: string) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("base64")}`;
}

test.describe("Omnichannel inbox smoke", () => {
  test.skip(!process.env.CRM_OMNI_E2E, "Set CRM_OMNI_E2E=1 with isolated API/Vite/DATABASE_URL");
  test.setTimeout(180_000);

  let staff: OmniStaff;

  test.beforeAll(() => {
    staff = seedOmni();
  });

  test("Contact form to inbox operations, channel health, fixtures, RBAC", async ({ page, request }) => {
    await proxyApi(page);
    const token = randomUUID().slice(0, 8);
    const email = `omni.contact.${token}@example.com`;
    const firstName = `Omni${token.slice(0, 4)}`;
    await fillGeneralContact(page, email, firstName);
    await expect(page.getByTestId("contact-confirmation")).toBeVisible({ timeout: 30_000 });

    const listed = await request.get(
      `${apiRoot}/api/platform/contact/inquiries?search=${encodeURIComponent(email)}&limit=10`,
      { headers: { "x-crm-test-staff-id": staff.admin.id } },
    );
    expect(listed.ok()).toBeTruthy();
    const listedBody = (await listed.json()) as { items: Array<{ id: string; channel?: string }> };
    expect(listedBody.items.length).toBeGreaterThan(0);
    const inquiryId = listedBody.items[0]!.id;
    const detail = await request.get(`${apiRoot}/api/platform/contact/inquiries/${inquiryId}`, {
      headers: { "x-crm-test-staff-id": staff.admin.id },
    });
    expect(detail.ok()).toBeTruthy();
    const detailBody = (await detail.json()) as {
      inquiry: { channel: string; status: string; priority: string };
      contact: { email: string };
      messages: Array<{ body: string }>;
      identities: Array<{ channel: string }>;
    };
    expect(detailBody.contact.email.toLowerCase()).toContain("omni.contact");
    expect(detailBody.inquiry.channel).toMatch(/web/i);
    expect(detailBody.messages.some((m) => /Omnichannel inbox qualification/i.test(m.body))).toBeTruthy();
    expect(detailBody.identities.some((i) => i.channel === "website" || i.channel === "web_form")).toBeTruthy();

    await installPlatformAuth(page, staff.admin.id);
    await page.goto("/admin/contact", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByTestId("admin-inbox")).toBeVisible({ timeout: 25_000 });
    await page.getByTestId("inbox-search").fill(firstName);
    await expect(page.getByTestId(`inbox-open-${inquiryId}`)).toBeAttached({ timeout: 20_000 });
    await page.goto(`/admin/contact/${inquiryId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByTestId("inquiry-workspace")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("inquiry-timeline")).toContainText(/Omnichannel inbox qualification/i);
    await expect(page.locator("text=Channel:")).toContainText(/website|web_form/i);
    await expect(page.getByTestId("inquiry-sla")).toBeVisible();

    await page.getByTestId("composer-tab-note").click();
    await page.locator("#inquiry-composer").fill("Internal omni note");
    await page.getByTestId("inquiry-send").click();
    await expect(page.getByTestId("inquiry-timeline")).toContainText("Internal omni note");

    await page.getByTestId("inquiry-tag-input").fill("omni-qual");
    await page.getByTestId("inquiry-tag-add").click({ force: true });
    await expect(page.getByTestId("inquiry-tags")).toContainText(/omni/i);

    await page.getByTestId("inquiry-assignment").selectOption(staff.admin.id);
    await page.getByTestId("inquiry-status").selectOption("IN_PROGRESS");
    await page.getByTestId("inquiry-priority").selectOption("high");

    await page.getByTestId("composer-tab-reply").click();
    await page.locator("#inquiry-composer").fill("Website reply from unified inbox");
    await page.getByTestId("inquiry-send").click();
    await expect(page.getByTestId("inquiry-timeline")).toContainText("Website reply from unified inbox");

    const retry = page.getByRole("button", { name: /Retry \/ reconcile outbound/i });
    if (await retry.count()) await retry.first().click();

    await page.goto("/admin/contact/channels", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByTestId("channel-health")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("channel-row-whatsapp")).toBeVisible();
    await expect(page.getByTestId("channel-status-tiktok")).toContainText("UNSUPPORTED");
    await expect(page.getByTestId("channel-health-refresh")).toBeVisible();
    await page.getByTestId("channel-health-refresh").click();

    await page.goto(`/admin/contact/${staff.tiktokInquiryId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByRole("alert")).toContainText(/TikTok|handoff|public/i);

    await installPlatformAuth(page, staff.auditor.id);
    await page.goto("/admin/contact/channels", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByTestId("channel-health-refresh")).toHaveCount(0);
    const auditorReply = await request.post(`${apiRoot}/api/platform/contact/inquiries/${staff.tiktokInquiryId}/reply`, {
      headers: {
        "content-type": "application/json",
        "x-crm-test-staff-id": staff.auditor.id,
        origin: siteOrigin,
      },
      data: { body: "auditor must not reply" },
    });
    expect(auditorReply.status()).toBe(403);

    await installPlatformAuth(page, staff.agentA.id);
    const hidden = await request.get(`${apiRoot}/api/platform/contact/inquiries/${staff.foreignInquiryId}`, {
      headers: { "x-crm-test-staff-id": staff.agentA.id },
    });
    expect(hidden.status()).toBe(403);
    const manage = await request.post(`${apiRoot}/api/platform/contact/channels/health-check`, {
      headers: {
        "content-type": "application/json",
        "x-crm-test-staff-id": staff.agentA.id,
        origin: siteOrigin,
      },
      data: {},
    });
    expect(manage.status()).toBe(403);

    const waSecret = process.env.WHATSAPP_APP_SECRET || "wa-fixture-secret";
    const metaSecret = process.env.META_APP_SECRET || "meta-fixture-secret";
    const xSecret = process.env.X_CONSUMER_SECRET || "x-fixture-secret";
    const waBody = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "cloud-api" },
                messages: [
                  {
                    id: `wamid.pw.${token}`,
                    from: "15550001999",
                    type: "text",
                    text: { body: `playwright wa ${token}` },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(waBody);
    const fixture = await request.post(`${apiRoot}/api/contact/webhooks/whatsapp`, {
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSig(waSecret, raw) },
      data: raw,
    });
    expect(fixture.status()).toBe(202);
    const dup = await request.post(`${apiRoot}/api/contact/webhooks/whatsapp`, {
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSig(waSecret, raw) },
      data: raw,
    });
    expect(dup.status()).toBe(202);
    const badSig = await request.post(`${apiRoot}/api/contact/webhooks/whatsapp`, {
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSig("wrong", raw) },
      data: raw,
    });
    expect(badSig.status()).toBe(401);

    const msBody = {
      object: "page",
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              sender: { id: `psid-pw-${token}` },
              recipient: { id: "page-1" },
              timestamp: Date.now(),
              message: { mid: `mid.pw.${token}`, text: `playwright messenger ${token}` },
            },
          ],
        },
      ],
    };
    const msRaw = JSON.stringify(msBody);
    expect(
      (
        await request.post(`${apiRoot}/api/contact/webhooks/meta`, {
          headers: { "content-type": "application/json", "x-hub-signature-256": metaSig(metaSecret, msRaw) },
          data: msRaw,
        })
      ).status(),
    ).toBe(202);

    const igBody = {
      object: "instagram",
      entry: [
        {
          id: "ig-1",
          messaging: [
            {
              sender: { id: `igid-pw-${token}` },
              recipient: { id: "ig-1" },
              timestamp: Date.now(),
              message: { mid: `igmid.pw.${token}`, text: `playwright ig ${token}` },
            },
          ],
        },
      ],
    };
    const igRaw = JSON.stringify(igBody);
    expect(
      (
        await request.post(`${apiRoot}/api/contact/webhooks/meta`, {
          headers: { "content-type": "application/json", "x-hub-signature-256": metaSig(metaSecret, igRaw) },
          data: igRaw,
        })
      ).status(),
    ).toBe(202);

    const xBody = {
      for_user_id: "acct",
      direct_message_events: [
        {
          id: `dm-pw-${token}`,
          type: "message_create",
          message_create: {
            sender_id: `user-pw-${token}`,
            target: { recipient_id: "acct" },
            message_data: { text: `playwright x ${token}` },
          },
        },
      ],
    };
    const xRaw = JSON.stringify(xBody);
    expect(
      (
        await request.post(`${apiRoot}/api/contact/webhooks/x`, {
          headers: { "content-type": "application/json", "x-twitter-webhooks-signature": xSig(xSecret, xRaw) },
          data: xRaw,
        })
      ).status(),
    ).toBe(202);

    const malformed = { object: "whatsapp_business_account", entry: [] };
    const malRaw = JSON.stringify(malformed);
    expect(
      (
        await request.post(`${apiRoot}/api/contact/webhooks/whatsapp`, {
          headers: { "content-type": "application/json", "x-hub-signature-256": metaSig(waSecret, malRaw) },
          data: malRaw,
        })
      ).status(),
    ).toBe(202);

    await installPlatformAuth(page, staff.admin.id);
    let waInquiryId: string | null = null;
    const started = Date.now();
    while (Date.now() - started < 15_000) {
      const listedWa = await request.get(`${apiRoot}/api/platform/contact/inquiries?channel=whatsapp&limit=50`, {
        headers: { "x-crm-test-staff-id": staff.admin.id },
      });
      const body = (await listedWa.json()) as { items: Array<{ id: string }> };
      for (const item of body.items ?? []) {
        const d = await request.get(`${apiRoot}/api/platform/contact/inquiries/${item.id}`, {
          headers: { "x-crm-test-staff-id": staff.admin.id },
        });
        const dj = (await d.json()) as { messages?: Array<{ body: string }> };
        if (dj.messages?.some((m) => m.body.includes(`playwright wa ${token}`))) {
          waInquiryId = item.id;
          break;
        }
      }
      if (waInquiryId) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(waInquiryId).toBeTruthy();
    await page.goto(`/admin/contact/${waInquiryId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByTestId("inquiry-timeline")).toContainText(`playwright wa ${token}`, { timeout: 20_000 });
    await page.goto("/admin/contact/channels", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByTestId("channel-quarantine-count")).toBeVisible();
    const channels = await request.get(`${apiRoot}/api/platform/contact/channels`, {
      headers: { "x-crm-test-staff-id": staff.admin.id },
    });
    expect(channels.ok()).toBeTruthy();
    const channelBody = (await channels.json()) as { quarantineOpenCount?: number };
    expect((channelBody.quarantineOpenCount ?? 0) >= 1).toBeTruthy();
  });
});
