import { expect, test, type Page } from "./fixtures";
import { expectNoBlockingAxe, gotoPublic, runAxe } from "./a11y-helpers";

function relativeLuminance(rgb: [number, number, number]) {
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a: [number, number, number], b: [number, number, number]) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

async function computedPair(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fill: cs.webkitTextFillColor || cs.color,
    };
  });
}

function assertAa(label: string, colorCss: string, bgCss: string) {
  const fg = parseRgb(colorCss);
  const bg = parseRgb(bgCss);
  expect(fg, `${label} color ${colorCss}`).toBeTruthy();
  expect(bg, `${label} background ${bgCss}`).toBeTruthy();
  const ratio = contrastRatio(fg!, bg!);
  expect(ratio, `${label} ${colorCss} on ${bgCss} ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
}

test.describe("Arabic pricing contrast states", () => {
  test("axe plus sales mailto and discount badge contrast in default hover focus visited", async ({ page }) => {
    await gotoPublic(page, "/ar/price");
    await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
    expect(await page.locator(".self-end").count(), "legacy self-end badge must be gone").toBe(0);
    await page.locator("table").first().scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const matrixSample = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, missing: true };
        const cs = getComputedStyle(el);
        return {
          sel,
          color: cs.color,
          fill: cs.webkitTextFillColor,
          backgroundColor: cs.backgroundColor,
          fontSize: cs.fontSize,
          opacity: cs.opacity,
          text: (el.textContent ?? "").trim().slice(0, 80),
        };
      };
      return [
        pick("thead th:nth-child(3)"),
        pick("thead th:nth-child(4)"),
        pick("td.text-sm.font-medium"),
        pick("td.bg-steel span"),
        pick("td span.text-xs"),
      ];
    });
    await runAxe(page);
    const axeDetail = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: Function } }).axe;
      const root = document.querySelector("main") ?? document.documentElement;
      const results = await axe.run(root, { runOnly: { type: "tag", values: ["wcag2aa"] } });
      const v = results.violations.find((x: { id: string }) => x.id === "color-contrast");
      if (!v) return { count: 0, samples: [] };
      return {
        count: v.nodes.length,
        samples: v.nodes.slice(0, 6).map((n: { html: string; target: string[]; any?: Array<{ data?: { fgColor?: string; bgColor?: string; contrastRatio?: number; fontSize?: string } }> }) => ({
          target: n.target,
          html: n.html.slice(0, 180),
          fg: n.any?.[0]?.data?.fgColor,
          bg: n.any?.[0]?.data?.bgColor,
          ratio: n.any?.[0]?.data?.contrastRatio,
          fontSize: n.any?.[0]?.data?.fontSize,
        })),
      };
    });
    test.info().annotations.push({ type: "note", description: JSON.stringify(axeDetail) });
    try {
      await expectNoBlockingAxe(page);
    } catch (err) {
      throw new Error(
        `matrixSample=${JSON.stringify(matrixSample)}\naxeDetail=${JSON.stringify(axeDetail)}\n${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const sales = page.locator('a[href="mailto:sales@claimtagx.com"]').first();
    await expect(sales).toBeVisible();
    const badge = page.locator(".tracking-wide").first();
    await expect(badge).toBeVisible();

    const salesDefault = await computedPair(page, 'a[href="mailto:sales@claimtagx.com"]');
    assertAa("sales default", salesDefault.fill, salesDefault.backgroundColor);

    await sales.hover();
    const salesHover = await computedPair(page, 'a[href="mailto:sales@claimtagx.com"]');
    assertAa("sales hover", salesHover.fill, salesHover.backgroundColor);

    await sales.focus();
    const salesFocus = await computedPair(page, 'a[href="mailto:sales@claimtagx.com"]');
    assertAa("sales focus", salesFocus.fill, salesFocus.backgroundColor);

    const badgeDefault = await computedPair(page, ".tracking-wide");
    assertAa("discount badge default", badgeDefault.color, badgeDefault.backgroundColor);
    await badge.hover();
    const badgeHover = await computedPair(page, ".tracking-wide");
    assertAa("discount badge hover", badgeHover.color, badgeHover.backgroundColor);

    const visitedRules = await page.evaluate(() => {
      const wanted: Array<{ selector: string; color: string; background: string; fill: string }> = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (!rule.selectorText.includes(":visited")) continue;
          if (!/cta-lime|cta-steel/.test(rule.selectorText)) continue;
          wanted.push({
            selector: rule.selectorText,
            color: rule.style.color,
            background: rule.style.backgroundColor,
            fill: rule.style.getPropertyValue("-webkit-text-fill-color"),
          });
        }
      }
      return wanted;
    });
    expect(visitedRules.length, JSON.stringify(visitedRules)).toBeGreaterThan(0);
    const limeVisited = visitedRules.find((r) => r.selector.includes("cta-lime"));
    expect(limeVisited, JSON.stringify(visitedRules)).toBeTruthy();
    const limeColor = (limeVisited!.fill || limeVisited!.color).replace(/\s/g, "").toLowerCase();
    expect(limeColor === "#0b0f19" || limeColor.includes("11, 15, 25") || limeColor.includes("11,15,25")).toBeTruthy();
  });
});
