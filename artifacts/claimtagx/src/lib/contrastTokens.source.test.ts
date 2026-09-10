import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** WCAG 2 relative luminance (sRGB). Engineering evidence only — not a conformance claim. */
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const v = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
  const rgb = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}

function contrast(fg: string, bg: string): number {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

const OBSIDIAN = "#0B0F19";
const STEEL = "#1F2937";
const LIME = "#C6F24E";
const LIME_HOVER = "#D4FF5E";
const INK = "#D5DCE6";
const INK_MUTED = "#C5CED9";
const PAPER = "#FFFFFF";
const SLATE_BRAND = "#64748B";

describe("semantic contrast tokens (engineering)", () => {
  it("brand slate on steel fails AA body text; ink tokens pass", () => {
    assert.ok(contrast(SLATE_BRAND, STEEL) < 4.5, "brand slate must not be used as body text on steel");
    assert.ok(contrast(INK, OBSIDIAN) >= 4.5);
    assert.ok(contrast(INK, STEEL) >= 4.5);
    assert.ok(contrast(INK_MUTED, OBSIDIAN) >= 4.5);
    assert.ok(contrast(INK_MUTED, STEEL) >= 4.5);
  });

  it("CTA lime/obsidian pairs pass in default, hover, and disabled", () => {
    assert.ok(contrast(OBSIDIAN, LIME) >= 4.5);
    assert.ok(contrast(OBSIDIAN, LIME_HOVER) >= 4.5);
    assert.ok(contrast(INK, STEEL) >= 4.5);
  });

  it("paper on steel and lime on obsidian pass for labels", () => {
    assert.ok(contrast(PAPER, STEEL) >= 4.5);
    assert.ok(contrast(LIME, OBSIDIAN) >= 3);
  });
});
