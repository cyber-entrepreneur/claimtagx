import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const distDir = join(repoRoot, "artifacts", "claimtagx", "dist", "public");
const registry = JSON.parse(
  readFileSync(join(repoRoot, "artifacts", "claimtagx", "content", "seo", "routes.json"), "utf8"),
);
const legalPolicy = JSON.parse(
  readFileSync(join(repoRoot, "artifacts", "claimtagx", "content", "seo", "legal-localization-policy.json"), "utf8"),
);
const legalPaths = new Set(legalPolicy.paths);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function localizedPath(path, locale) {
  if (locale === "en") return path;
  if (path === "/") return "/ar";
  return `/ar${path}`;
}

function absoluteUrl(path, locale) {
  const normalized = localizedPath(path, locale);
  return `${registry.siteUrl.replace(/\/$/, "")}${normalized === "/" ? "" : normalized}`;
}

function hreflangBlock(path) {
  const en = `<link rel="alternate" hreflang="en" href="${absoluteUrl(path, "en")}" />`;
  const ar = `<link rel="alternate" hreflang="ar" href="${absoluteUrl(path, "ar")}" />`;
  const xd = `<link rel="alternate" hreflang="x-default" href="${absoluteUrl(path, "en")}" />`;
  if (legalPaths.has(path)) {
    return [en, xd].join("\n    ");
  }
  return [en, ar, xd].join("\n    ");
}

const SOFTWARE_APP_LD_JSON_RE =
  /<script type="application\/ld\+json">\s*\{[\s\S]*?"@type":\s*"SoftwareApplication"[\s\S]*?<\/script>/;

function jsonLdScript(payload) {
  return `<script type="application/ld+json">\n    ${JSON.stringify(payload, null, 2).replace(/\n/g, "\n    ")}\n    </script>`;
}

function applyJsonLd(html, jsonLd) {
  if (!jsonLd) return html;
  const script = jsonLdScript(jsonLd);
  if (SOFTWARE_APP_LD_JSON_RE.test(html)) {
    return html.replace(SOFTWARE_APP_LD_JSON_RE, script);
  }
  return html.replace("</head>", `    ${script}\n  </head>`);
}

function applyMeta(template, params) {
  let html = template;
  html = html.replace(/<html lang="[^"]*"(?: dir="[^"]*")?/, `<html lang="${params.lang}" dir="${params.dir}"`);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(params.title)}</title>`);
  html = html.replace(
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${escapeHtml(params.description)}"`,
  );
  html = html.replace(
    /<link rel="canonical" href="[^"]*"/,
    `<link rel="canonical" href="${escapeHtml(params.canonical)}"`,
  );
  html = html.replace(
    /<meta name="robots" content="[^"]*"/,
    `<meta name="robots" content="${params.robots ?? "index, follow"}"`,
  );
  html = html.replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${escapeHtml(params.title)}"`);
  html = html.replace(
    /<meta property="og:description" content="[^"]*"/,
    `<meta property="og:description" content="${escapeHtml(params.description)}"`,
  );
  html = html.replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${escapeHtml(params.canonical)}"`);
  html = html.replace(/<meta property="og:locale" content="[^"]*" \/>/i, `<meta property="og:locale" content="${params.ogLocale}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${escapeHtml(params.title)}"`);
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*"/,
    `<meta name="twitter:description" content="${escapeHtml(params.description)}"`,
  );
  if (!html.includes('hreflang="en"')) {
    html = html.replace("</head>", `    ${hreflangBlock(params.path)}\n  </head>`);
  } else {
    html = html.replace(/<link rel="alternate" hreflang="en" href="[^"]*" \/>[\s\S]*?<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/, hreflangBlock(params.path));
  }
  html = applyJsonLd(html, params.jsonLd);
  return html;
}

function writeRouteHtml(relPath, html) {
  const outPath = join(distDir, relPath, "index.html");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");
}

const template = readFileSync(join(distDir, "index.html"), "utf8");
let count = 0;

for (const route of registry.routes) {
  if (!route.index) continue;
  for (const locale of ["en", "ar"]) {
    const copy = route[locale];
    if (!copy) continue;
    const path = route.path;
    const arabicLegal = legalPaths.has(path) && locale === "ar";
    const html = applyMeta(template, {
      path,
      lang: locale === "ar" ? "ar" : "en",
      dir: locale === "ar" ? "rtl" : "ltr",
      title: copy.title,
      description: copy.description,
      canonical: arabicLegal ? absoluteUrl(path, "en") : absoluteUrl(path, locale),
      ogLocale: locale === "ar" ? "ar" : "en_US",
      robots: arabicLegal ? legalPolicy.arabicRobots : route.robots,
      jsonLd: route.jsonLd?.[locale],
    });
    if (locale === "en" && path === "/") {
      writeFileSync(join(distDir, "index.html"), html, "utf8");
      count += 1;
      continue;
    }
    const rel = localizedPath(path, locale).replace(/^\//, "") || ".";
    writeRouteHtml(rel === "." ? "" : rel, html);
    count += 1;
  }
}

console.log(`Prerendered ${count} public HTML shells into ${distDir}`);
