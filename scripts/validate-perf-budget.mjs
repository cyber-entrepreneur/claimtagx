import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "artifacts", "claimtagx", "dist", "public");
const handlerDir = join(dist, "handler");
const manifestCandidates = [join(dist, ".vite", "manifest.json"), join(dist, "manifest.json")];

/**
 * Local lab regression caps (bytes, uncompressed). Not field CWV.
 * Route budgets apply to the named Vite chunk only, not transitive shared
 * chunks or modulepreload hints. Marketing raster originals (Hero PNG and
 * industry stills) are excepted from routeLoadedImageMax — do not recompress
 * them to pass this gate.
 */
const BUDGETS = {
  cssMax: 200_000,
  publicEntryJsMax: 500_000,
  contactRouteJsMax: 250_000,
  adminRouteJsMax: 450_000,
  legalRouteJsMax: 80_000,
  solutionRouteJsMax: 530_000,
  handlerAppMax: 1_800_000,
  routeLoadedImageMax: 400_000,
  initialRequestCountMax: 40,
};

const MARKETING_IMAGE_EXCEPTIONS = [
  /hero-mockup/i,
  /feature-hero/i,
  /industry-(valet|laundry|luggage|repair)/i,
];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function sizes(buf) {
  return {
    raw: buf.length,
    gzip: gzipSync(buf).length,
    brotli: brotliCompressSync(buf).length,
  };
}

function loadManifest() {
  for (const p of manifestCandidates) {
    if (existsSync(p)) return { path: p, data: JSON.parse(readFileSync(p, "utf8")) };
  }
  return null;
}

function chunkFiles(manifest, matcher) {
  const files = new Set();
  for (const [id, entry] of Object.entries(manifest)) {
    if (!matcher(id, entry)) continue;
    if (entry.file && /\.js$/i.test(entry.file)) files.add(entry.file);
  }
  return [...files];
}

function sumFiles(relPaths) {
  let raw = 0;
  const files = [];
  for (const rel of relPaths) {
    const full = join(dist, rel);
    if (!existsSync(full)) continue;
    const buf = readFileSync(full);
    const s = sizes(buf);
    raw += s.raw;
    files.push({ file: rel, ...s });
  }
  return { raw, files };
}

if (!existsSync(dist)) {
  console.error("dist/public missing; build the website first");
  process.exit(1);
}

const manifestWrap = loadManifest();
if (!manifestWrap) {
  console.error("Vite manifest.json missing; enable build.manifest and rebuild");
  process.exit(1);
}

const manifest = manifestWrap.data;
const cssFiles = walk(join(dist, "assets")).filter((p) => p.endsWith(".css"));
const images = walk(dist).filter((p) => /\.(png|jpe?g|webp|gif|svg)$/i.test(p) && !p.includes(`${join("handler")}`));
let fail = 0;
const failures = [];

function check(name, actual, max) {
  if (actual > max) {
    failures.push(`${name} ${actual} > ${max}`);
    fail += 1;
  }
}

const cssTotal = cssFiles.reduce((n, p) => n + statSync(p).size, 0);
check("cssMax", cssTotal, BUDGETS.cssMax);

const entryKeys = Object.entries(manifest).filter(([, e]) => e.isEntry);
const entryFiles = chunkFiles(manifest, (_id, e) => e.isEntry);
const entrySum = sumFiles(entryFiles);
check("publicEntryJsMax", entrySum.raw, BUDGETS.publicEntryJsMax);

const contactFiles = chunkFiles(manifest, (id) => /Contact/i.test(id));
const adminFiles = chunkFiles(manifest, (id, e) => /admin/i.test(id) || e.file?.includes("admin"));
const legalFiles = chunkFiles(manifest, (id, e) => /legal/i.test(id) || e.file?.includes("legal"));
const solutionFiles = chunkFiles(manifest, (id, e) => /Solution/i.test(id) || e.file?.includes("solution"));
check("contactRouteJsMax", sumFiles(contactFiles).raw, BUDGETS.contactRouteJsMax);
check("adminRouteJsMax", sumFiles(adminFiles).raw, BUDGETS.adminRouteJsMax);
check("legalRouteJsMax", sumFiles(legalFiles).raw, BUDGETS.legalRouteJsMax);
check("solutionRouteJsMax", sumFiles(solutionFiles).raw, BUDGETS.solutionRouteJsMax);

let handlerBytes = 0;
if (existsSync(handlerDir)) {
  for (const f of walk(handlerDir).filter((p) => p.endsWith(".js"))) handlerBytes += statSync(f).size;
}
check("handlerAppMax", handlerBytes, BUDGETS.handlerAppMax);

for (const img of images) {
  const base = img.replaceAll("\\", "/");
  if (MARKETING_IMAGE_EXCEPTIONS.some((re) => re.test(base))) continue;
  const n = statSync(img).size;
  if (n > BUDGETS.routeLoadedImageMax) {
    failures.push(`routeLoadedImageMax ${img} ${n} > ${BUDGETS.routeLoadedImageMax}`);
    fail += 1;
  }
}

const indexHtml = join(dist, "index.html");
const indexText = existsSync(indexHtml) ? readFileSync(indexHtml, "utf8") : "";
const initialRequests = [...indexText.matchAll(/\b(?:src|href)=["'][^"']+["']/g)].length;
check("initialRequestCountMax", initialRequests, BUDGETS.initialRequestCountMax);

const contributors = walk(join(dist, "assets"))
  .filter((p) => /\.(js|css)$/.test(p))
  .map((p) => ({ file: p.slice(dist.length + 1).replaceAll("\\", "/"), ...sizes(readFileSync(p)) }))
  .sort((a, b) => b.raw - a.raw)
  .slice(0, 15);

const report = {
  labOnly: true,
  notProductionCwV: true,
  manifest: manifestWrap.path,
  budgets: BUDGETS,
  enforced: Object.keys(BUDGETS),
  cssTotal,
  publicEntry: { keys: entryKeys.map(([k]) => k), ...entrySum },
  contact: sumFiles(contactFiles),
  admin: sumFiles(adminFiles),
  legal: sumFiles(legalFiles),
  solution: sumFiles(solutionFiles),
  handlerBytes,
  initialRequests,
  largestContributors: contributors,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (fail) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log("perf-budget engineering check done (lab measurements; not CWV claims)");
