import { existsSync, readFileSync } from "node:fs";
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

function localizedPath(path, locale) {
  if (locale === "en") return path;
  if (path === "/") return "/ar";
  return `/ar${path}`;
}

function fileFor(path, locale) {
  const rel = localizedPath(path, locale);
  if (rel === "/") return join(distDir, "index.html");
  return join(distDir, rel.replace(/^\//, ""), "index.html");
}

const required = [
  /<title>[^<]+<\/title>/,
  /<meta name="description" content="[^"]+"/,
  /<link rel="canonical" href="https:\/\/claimtagx\.com/,
  /hreflang="en"/,
  /hreflang="ar"/,
  /hreflang="x-default"/,
  /property="og:title"/,
  /property="og:description"/,
];

const SOFTWARE_APP_LD_JSON_RE =
  /<script type="application\/ld\+json">\s*\{[\s\S]*?"@type":\s*"SoftwareApplication"[\s\S]*?<\/script>/;

function ldJsonBlocks(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function hasJsonLdType(html, expectedType) {
  return ldJsonBlocks(html).some((block) => {
    try {
      const parsed = JSON.parse(block.trim());
      return parsed["@type"] === expectedType;
    } catch {
      return block.includes(`"@type": "${expectedType}"`);
    }
  });
}

let failures = 0;
for (const route of registry.routes) {
  if (!route.index) continue;
  for (const locale of ["en", "ar"]) {
    if (!route[locale]) continue;
    const file = fileFor(route.path, locale);
    if (!existsSync(file)) {
      console.error(`Missing prerender file: ${file}`);
      failures += 1;
      continue;
    }
    const html = readFileSync(file, "utf8");
    const legalPage = legalPaths.has(route.path);
    const arabicLegal = legalPage && locale === "ar";
    const patterns = legalPage ? required.filter((p) => p.source !== 'hreflang="ar"') : required;
    for (const pattern of patterns) {
      if (!pattern.test(html)) {
        console.error(`${file} missing ${pattern}`);
        failures += 1;
      }
    }
    if (legalPage && /hreflang="ar"/.test(html)) {
      console.error(`${file} legal page must not advertise hreflang=ar until qualified Arabic legal copy exists`);
      failures += 1;
    }
    if (arabicLegal) {
      if (!/noindex/.test(html)) {
        console.error(`${file} Arabic legal shell must be noindex`);
        failures += 1;
      }
      if (/hreflang="ar"/.test(html)) {
        console.error(`${file} Arabic legal shell must not advertise hreflang=ar`);
        failures += 1;
      }
      if (!html.includes(`rel="canonical" href="https://claimtagx.com${route.path === "/" ? "" : route.path}"`)) {
        console.error(`${file} Arabic legal canonical must point at English URL`);
        failures += 1;
      }
    }
    if (locale === "ar" && !html.includes('dir="rtl"')) {
      console.error(`${file} missing dir=rtl`);
      failures += 1;
    }
    const expectedJsonLd = route.jsonLd?.[locale];
    if (expectedJsonLd) {
      const expectedType = expectedJsonLd["@type"];
      if (!hasJsonLdType(html, expectedType)) {
        console.error(`${file} missing route-specific JSON-LD (@type: ${expectedType})`);
        failures += 1;
      }
      if (expectedType !== "SoftwareApplication" && SOFTWARE_APP_LD_JSON_RE.test(html)) {
        console.error(`${file} still contains generic SoftwareApplication JSON-LD`);
        failures += 1;
      }
    }
  }
}

if (failures) {
  console.error(`SEO HTML validation failed (${failures} issues)`);
  process.exit(1);
}
console.log("SEO HTML validation passed.");
