import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToPlainText, sanitizeHtml } from "./htmlSanitize.ts";

describe("htmlSanitize", () => {
  it("strips scripts and event handlers", () => {
    const out = sanitizeHtml(`<p onclick="alert(1)">Hi<script>evil()</script></p>`);
    assert.equal(out.includes("script"), false);
    assert.equal(out.includes("onclick"), false);
    assert.match(out, /<p>Hi<\/p>/);
  });

  it("keeps safe links and drops javascript hrefs", () => {
    const safe = sanitizeHtml(`<a href="https://claimtagx.com">site</a>`);
    assert.match(safe, /href="https:\/\/claimtagx.com"/);
    const bad = sanitizeHtml(`<a href="javascript:alert(1)">x</a>`);
    assert.equal(bad.includes("javascript"), false);
  });

  it("strips stored XSS vectors used in CMS HTML", () => {
    const stored = sanitizeHtml(
      `<img src=x onerror="alert(1)"><svg><script>alert(2)</script></svg><iframe src="javascript:alert(3)"></iframe>`,
    );
    assert.equal(/onerror|javascript:|<script|<iframe/i.test(stored), false);
  });

  it("neutralizes reflected javascript URLs in CMS fragments", () => {
    const out = sanitizeHtml(`<p><a href="JaVaScRiPt:alert(1)">click</a></p>`);
    assert.equal(out.toLowerCase().includes("javascript"), false);
  });

  it("produces a plain-text fallback", () => {
    assert.equal(htmlToPlainText("<p>Hello<br>world</p>"), "Hello\nworld");
  });
});
