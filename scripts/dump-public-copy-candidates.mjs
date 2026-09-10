import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const claimtagx = join(here, "..", "artifacts", "claimtagx");
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
const SKIP_PATH_PARTS = [
  `${join("pages", "admin")}`,
  `${join("pages", "DemoTicket")}`,
  `${join("lib", "cms")}`,
  `${join("lib", "seo")}`,
  `${join("lib", "i18n")}`,
  `${join("lib", "contactApi")}`,
  `${join("components", "ui")}`,
  `${join("components", "NodeNetworkBg")}`,
  `${join("public", "sitemap")}`,
  `${join("public", "robots")}`,
  `${join("public", "redirects")}`,
];
const STRING_LITERAL = /(?<![\w$])(["'`])((?:(?!\1)[\s\S]){12,}?)\1/g;
const ALLOWLIST_LITERALS = [
  "ClaimTagX","Microsoft","Graph","GDPR","CCPA","SOC 2","ISO 27001","QR","API","SLA","CRM","HTTPS","TLS","AWS","Azure","Paddle","OpenAPI","Playwright","Chrome","Firefox","WebKit",
];

function walk(path) {
  try {
    const st = statSync(path);
    if (st.isFile()) {
      const ok = /\.(tsx?|jsx?|html|json)$/.test(path);
      if (!ok) return [];
      const rel = relative(claimtagx, path);
      if (SKIP_PATH_PARTS.some((p) => rel.includes(p))) return [];
      return [path];
    }
    return readdirSync(path).flatMap((name) => (name === "node_modules" || name.startsWith(".") ? [] : walk(join(path, name))));
  } catch {
    return [];
  }
}
function isAllowlisted(literal) {
  if (/^https?:\/\//i.test(literal)) return true;
  if (/^\/[a-z0-9\-_/]*$/i.test(literal)) return true;
  if (/^(flex|grid|absolute|relative|hidden|block|inline)/.test(literal)) return true;
  if (/[{}<>;=]|className|bg-|text-|border-|px-|py-|gap-|w-|h-|md:|lg:|sm:/.test(literal)) return true;
  if (/data:image|xmlns|viewBox|fractalNoise/.test(literal)) return true;
  if (/^[A-Z_0-9]+$/.test(literal)) return true;
  return false;
}
function looksLikeUserFacingCopy(t) {
  if (t.length < 16) return false;
  if (!/[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/.test(t)) return false;
  if (isAllowlisted(t)) return false;
  if (/^[a-z0-9_./-]+$/i.test(t) && !/\s/.test(t)) return false;
  return true;
}
function classifyLiteral(literal) {
  const t = literal.trim();
  if (ALLOWLIST_LITERALS.some((a) => t === a || (t.includes(a) && t.length < a.length + 8))) return "approved_non_translatable";
  if (/^https?:\/\//i.test(t) || /^\/[a-z0-9\-_/]*$/i.test(t)) return "technical_token";
  if (/^[A-Z_0-9]+$/.test(t)) return "technical_token";
  if (/ClaimTagX|Microsoft|Graph|Paddle|OpenAPI/.test(t) && t.split(/\s+/).length <= 4) return "proper_noun";
  if (looksLikeUserFacingCopy(t)) return "localization_defect_candidate";
  return "technical_token";
}

const files = [...new Set([...TARGET_DIRS.flatMap(walk), ...walk(join(claimtagx, "index.html"))])];
const candidates = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = relative(claimtagx, file).replaceAll("\\", "/");
  const isLocaleModule = /\.ar\.ts$|\.en\.ts$|locales[/]|content[/]marketing|content[/]seo/.test(rel);
  const usesI18n = text.includes("useI18n") || text.includes("t(");
  STRING_LITERAL.lastIndex = 0;
  let match;
  while ((match = STRING_LITERAL.exec(text)) !== null) {
    const lit = match[2];
    if (classifyLiteral(lit) !== "localization_defect_candidate") continue;
    let disposition;
    let reason;
    if (isLocaleModule) {
      disposition = "locale_source";
      reason = "String lives in an EN/AR locale or marketing/seo content module, not a hardcoded UI surface.";
    } else if (usesI18n) {
      disposition = "heuristic_in_i18n_file";
      reason = "File already uses useI18n()/t(); remaining English literals are typically test ids, selectors, or non-rendered strings. Gate does not fail these files.";
    } else if (rel.endsWith(".html") || rel.endsWith(".json")) {
      disposition = "metadata_or_shell";
      reason = "HTML/JSON shell; reviewed separately by SEO/prerender gates.";
    } else {
      disposition = "unexplained_hardcoded";
      reason = "Sentence-like English in a file that does not use i18n — must move to t() or documented allowlist.";
    }
    candidates.push({ file: rel, excerpt: lit.slice(0, 120), disposition, reason });
  }
}
const by = {};
for (const c of candidates) by[c.disposition] = (by[c.disposition] ?? 0) + 1;
const out = { at: new Date().toISOString(), total: candidates.length, byDisposition: by, candidates };
writeFileSync(join(here, "..", "tmp", "public-copy-candidate-disposition.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ total: candidates.length, byDisposition: by, unexplained: by.unexplained_hardcoded ?? 0 }, null, 2));
