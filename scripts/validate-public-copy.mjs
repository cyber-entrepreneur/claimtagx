import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Expression-level public-copy gate.
 * A file that imports useI18n() can still render hardcoded English.
 * Failures are category 8 (rendered hardcoded user-facing copy).
 */
const here = dirname(fileURLToPath(import.meta.url));
const claimtagx = process.env.PUBLIC_COPY_CLAIMTAGX_ROOT
  ? resolve(process.env.PUBLIC_COPY_CLAIMTAGX_ROOT)
  : join(here, "..", "artifacts", "claimtagx");
const root = join(claimtagx, "src");

const TARGET_DIRS = [
  join(root, "components", "sections"),
  join(root, "pages"),
  join(root, "components"),
  join(root, "lib"),
  join(root, "hooks"),
  join(claimtagx, "content"),
  join(claimtagx, "public"),
];
const EXTRA_FILES = [join(claimtagx, "index.html")];

const SKIP_PATH_PARTS = [
  `${join("pages", "admin")}`,
  `${join("pages", "DemoTicket")}`,
  `${join("lib", "cms")}`,
  `${join("lib", "seo")}`,
  `${join("lib", "contactApi")}`,
  `${join("components", "ui")}`,
  `${join("components", "NodeNetworkBg")}`,
  `${join("public", "sitemap")}`,
  `${join("public", "robots")}`,
  `${join("public", "redirects")}`,
];

/** Documented: legal body pending qualified translation review — not metadata. */
const DOCUMENTED_EXCEPTIONS = [
  {
    glob: /^pages[/\\]legal[/\\]/,
    category: "legal_copy_pending_qualified_review",
    reason:
      "Legal body copy is English pending qualified legal/translation review. Shell chrome uses t(). Not approved Arabic law.",
  },
];

const ALLOWLIST_LITERALS = new Set([
  "ClaimTagX",
  "Microsoft",
  "Graph",
  "GDPR",
  "CCPA",
  "SOC 2",
  "ISO 27001",
  "QR",
  "API",
  "SLA",
  "CRM",
  "HTTPS",
  "TLS",
  "AWS",
  "Azure",
  "Clerk",
  "Paddle",
  "OpenAPI",
  "Ed25519",
]);

const BANNED_PHRASES = [
  /We use cookies to improve your experience/,
  /Questions operators ask/,
  /Paper tickets lose items/,
  /Start free — no card needed/,
  /Start free - no card needed/,
  /Talk to sales/,
  /Blind Custody/,
  /Page not found/,
  /Country suggested from your network location/,
  /Select the country that matches your phone number/,
  /Search country/,
  /Please specify/,
  /Which solution do you currently use\?/,
  /First name/,
  /Last name/,
  /Job title/,
  /Company name/,
  /Email address/,
  /Country calling code/,
  /No matching country/,
];

const RENDER_ATTRS =
  /\b(alt|placeholder|title|aria-label|aria-placeholder|aria-roledescription|aria-valuetext|aria-description)\s*=\s*(["'`])((?:(?!\2)[\s\S])*?)\2/gi;
const JSX_TEXT = />([^<>{][^<]*)</g;
const QUOTED = /(["'`])((?:(?!\1)[\s\S]){8,}?)\1/g;

function walk(path) {
  try {
    const st = statSync(path);
    if (st.isFile()) {
      const okExt = /\.(tsx?|jsx?|html|json)$/.test(path);
      if (!okExt) return [];
      const rel = relative(claimtagx, path);
      if (SKIP_PATH_PARTS.some((p) => rel.includes(p))) return [];
      return [path];
    }
    return readdirSync(path).flatMap((name) => {
      if (name === "node_modules" || name.startsWith(".")) return [];
      return walk(join(path, name));
    });
  } catch {
    return [];
  }
}

function lineAt(src, index) {
  return src.slice(0, index).split(/\n/).length;
}

function maskComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m) => m.replace(/[^\n]/g, " "));
}

function looksEnglishCopy(t) {
  const s = t.trim().replace(/\s+/g, " ");
  if (s.length < 12) return false;
  if (!/[A-Za-z]{3,}/.test(s)) return false;
  if (!/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(s) && !/[A-Za-z]{4,}[.…!?]$/.test(s)) return false;
  if (/^https?:\/\//i.test(s) || /^\/[a-z0-9\-_/]+$/i.test(s)) return false;
  if (/^(flex|grid|absolute|relative|hidden|block|inline|sr-only)/.test(s)) return false;
  if (/[{}=;]|className|bg-|text-|border-|px-|py-|gap-|w-|h-|md:|lg:|sm:/.test(s)) return false;
  if (/data:image|xmlns|viewBox|fractalNoise/.test(s)) return false;
  if (/^[A-Z0-9_./-]+$/.test(s)) return false;
  if (/^[a-z0-9._-]+(\.[a-z0-9._-]+)+$/i.test(s) && !/\s/.test(s)) return false;
  return true;
}

function isLocaleModule(rel) {
  return /\.ar\.ts$|\.en\.ts$|locales[/\\]|content[/\\]marketing|content[/\\]seo/.test(rel);
}

function documentedException(rel) {
  const n = rel.replaceAll("\\", "/");
  if (n.includes("/legal/") || n.startsWith("pages/legal/") || n.startsWith("src/pages/legal/")) {
    return DOCUMENTED_EXCEPTIONS[0];
  }
  return undefined;
}

function classify({ rel, text, index, kind, literal: lit }) {
  const line = lineAt(text, index);
  const before = text.slice(Math.max(0, index - 48), index);

  if (isLocaleModule(rel)) {
    return { category: "locale_source", line, kind };
  }
  if (/\.html$|\.json$/i.test(rel)) {
    return {
      category: "metadata_pending_localization",
      line,
      kind,
      reason: "HTML/JSON shell metadata; route titles come from SEO/prerender. Not legal body copy.",
    };
  }
  const doc = documentedException(rel);
  if (doc) {
    return { category: doc.category, line, kind, reason: doc.reason };
  }
  if (/\bdata-testid\s*=/.test(before) || /getByTestId|testId/.test(before)) {
    return { category: "test_or_selector", line, kind };
  }
  if (/\bt\(\s*$/.test(before)) {
    return { category: "rendered_localized", line, kind };
  }
  if (/href\s*=\s*$/.test(before) || /^https?:\/\//i.test(lit) || /^\/[a-z]/.test(lit)) {
    return { category: "non_rendered_technical", line, kind };
  }
  if (
    ALLOWLIST_LITERALS.has(lit.trim()) ||
    (lit.split(/\s+/).length <= 3 && /ClaimTagX|Microsoft|Paddle|Clerk/.test(lit))
  ) {
    return { category: "proper_noun", line, kind };
  }
  if (kind === "quoted" && /className|import |from |require\(/.test(before)) {
    return { category: "non_rendered_technical", line, kind };
  }
  if ((kind === "jsx" || kind === "attr") && looksEnglishCopy(lit)) {
    return { category: "rendered_hardcoded_defect", line, kind };
  }
  if (kind === "quoted" && looksEnglishCopy(lit) && !/\bt\(/.test(before)) {
    return { category: "rendered_pending_translation", line, kind };
  }
  return { category: "non_rendered_technical", line, kind };
}

function walkHits(rel, raw) {
  const text = maskComments(raw);
  const hits = [];
  const push = (literal, index, kind) => {
    const lit = literal.trim().replace(/\s+/g, " ");
    if (!looksEnglishCopy(lit) && kind !== "attr") return;
    if (kind === "attr" && !looksEnglishCopy(lit) && lit.length < 8) return;
    const cls = classify({ rel, text, index, kind, literal: lit });
    hits.push({
      file: rel.replaceAll("\\", "/"),
      line: cls.line,
      excerpt: lit.slice(0, 140),
      category: cls.category,
      kind,
      reason: cls.reason,
    });
  };

  RENDER_ATTRS.lastIndex = 0;
  let m;
  while ((m = RENDER_ATTRS.exec(text)) !== null) {
    push(m[3], m.index, "attr");
  }
  JSX_TEXT.lastIndex = 0;
  while ((m = JSX_TEXT.exec(text)) !== null) {
    push(m[1], m.index + 1, "jsx");
  }
  const JSX_BRACE_STRING = /\{\s*(["'`])((?:(?!\1)[\s\S])*?)\1\s*\}/g;
  while ((m = JSX_BRACE_STRING.exec(text)) !== null) {
    push(m[2], m.index, "jsx");
  }
  if (isLocaleModule(rel)) {
    QUOTED.lastIndex = 0;
    while ((m = QUOTED.exec(text)) !== null) {
      const lit = m[2];
      if (looksEnglishCopy(lit)) {
        hits.push({
          file: rel.replaceAll("\\", "/"),
          line: lineAt(text, m.index),
          excerpt: lit.trim().replace(/\s+/g, " ").slice(0, 140),
          category: "locale_source",
          kind: "locale",
        });
      }
    }
  }
  return hits;
}

const files = [...new Set([...TARGET_DIRS.flatMap(walk), ...EXTRA_FILES.flatMap(walk)])];
const discoveryRoots = [
  join(root, "pages"),
  join(root, "components", "sections"),
  join(root, "components"),
  join(claimtagx, "content"),
  join(claimtagx, "index.html"),
];
const discovered = [...new Set(discoveryRoots.flatMap(walk))];
const missingFromScan = discovered.filter((f) => {
  const rel = relative(claimtagx, f);
  if (SKIP_PATH_PARTS.some((p) => rel.includes(p))) return false;
  return !files.includes(f);
});
if (missingFromScan.length) {
  console.error("Public-copy discovery gap:\n" + missingFromScan.map((f) => relative(claimtagx, f)).join("\n"));
  process.exit(1);
}

const failures = [];
const allHits = [];
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const rel = relative(claimtagx, file);
  for (const pattern of BANNED_PHRASES) {
    if (isLocaleModule(rel)) continue;
    if (documentedException(rel)) continue;
    const masked = maskComments(raw);
    if (pattern.test(masked) && !/\bt\(/.test(masked.slice(Math.max(0, masked.search(pattern) - 20), masked.search(pattern)))) {
      const idx = masked.search(pattern);
      if (idx >= 0) {
        const before = masked.slice(Math.max(0, idx - 12), idx);
        if (!/\bt\(\s*$/.test(before) && !/\bt\('[^']*$/.test(before)) {
          failures.push(`${rel}:${lineAt(masked, idx)} banned phrase ${pattern} (must be a locale key, not a JSX literal)`);
        }
      }
    }
  }
  allHits.push(...walkHits(rel, raw));
}

const seen = new Set();
const deduped = [];
for (const h of allHits) {
  const k = `${h.file}:${h.line}:${h.excerpt}`;
  if (seen.has(k)) continue;
  seen.add(k);
  deduped.push(h);
}

const by = {};
for (const h of deduped) by[h.category] = (by[h.category] ?? 0) + 1;

const rendered = deduped.filter((h) => h.category === "rendered_hardcoded_defect");
for (const h of rendered) {
  failures.push(`${h.file}:${h.line} rendered hardcoded copy (${h.kind}): "${h.excerpt}"`);
}

const legalPending = deduped.filter((h) => h.category === "legal_copy_pending_qualified_review");
const editorialBlocked = legalPending.length > 0 || (by.metadata_pending_localization ?? 0) > 0;
const engineeringPass = failures.length === 0;
const verdict = !engineeringPass ? "FAIL" : editorialBlocked ? "PARTIAL" : "PASS";

const out = {
  at: new Date().toISOString(),
  method: "expression-level (JSX text, a11y/placeholder/alt attributes). Files using useI18n are not auto-cleared.",
  filesScanned: files.length,
  uniqueFindings: deduped.length,
  byCategory: by,
  renderedHardcodedDefects: rendered.length,
  legalCopyPendingQualifiedReview: legalPending.length,
  engineering: engineeringPass ? "PASS" : "FAIL",
  editorial: editorialBlocked ? "BLOCKED" : "PASS",
  verdict,
  findings: deduped,
};
const outputDirectory = process.env.PUBLIC_COPY_EVIDENCE_DIR
  ? resolve(process.env.PUBLIC_COPY_EVIDENCE_DIR)
  : join(here, "..", "tmp");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  join(outputDirectory, "public-copy-expression-disposition.json"),
  JSON.stringify(out, null, 2),
);

if (!engineeringPass) {
  console.error("Public-copy engineering FAIL:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(
  `public-copy engineering=PASS editorial=${out.editorial} verdict=${verdict} files=${files.length} unique=${deduped.length} legal_pending=${legalPending.length} byCategory=${JSON.stringify(by)}`,
);
if (editorialBlocked) {
  console.log("Localization editorial BLOCKED until qualified legal translations exist. Arabic legal routes are noindex and omitted from the sitemap.");
}
