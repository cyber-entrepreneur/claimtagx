import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const publicDir = join(repoRoot, "artifacts", "claimtagx", "public");
const registry = JSON.parse(
  readFileSync(join(repoRoot, "artifacts", "claimtagx", "content", "seo", "routes.json"), "utf8"),
);
const legalPolicy = JSON.parse(
  readFileSync(join(repoRoot, "artifacts", "claimtagx", "content", "seo", "legal-localization-policy.json"), "utf8"),
);
const legalPaths = new Set(legalPolicy.paths);

const SITE = registry.siteUrl.replace(/\/$/, "");

function urlEntry(path, priority, locale) {
  const loc = locale === "ar" ? `${SITE}/ar${path === "/" ? "" : path}` : `${SITE}${path}`;
  return `  <url><loc>${loc}</loc><priority>${priority}</priority></url>`;
}

const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];

let indexed = 0;
for (const route of registry.routes) {
  if (!route.index) continue;
  const priority = route.priority ?? "0.5";
  lines.push(urlEntry(route.path, priority));
  indexed += 1;
  if (legalPaths.has(route.path) && legalPolicy.arabicIndexable === false) continue;
  lines.push(urlEntry(route.path, priority, "ar"));
  indexed += 1;
}

lines.push("</urlset>", "");

writeFileSync(join(publicDir, "sitemap.xml"), lines.join("\n"), "utf8");
console.log(`Wrote sitemap to artifacts/claimtagx/public/sitemap.xml (${indexed} loc entries; Arabic legal routes excluded)`);
