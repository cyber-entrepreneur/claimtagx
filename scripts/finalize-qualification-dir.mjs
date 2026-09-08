/**
 * Finalize or supersede a qualification evidence directory.
 * Never modifies log files or an existing original manifest.json.
 * If manifest.json exists, writes manifest.corrected.json instead.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { execSync } from "node:child_process";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  aggregateLogs,
  parseOrchestrationSummary,
  parsePlaywrightQualificationLog,
} from "./lib/qualificationLogParse.mjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const dirArg = process.argv[2];
if (!dirArg || !existsSync(dirArg)) {
  console.error("usage: node scripts/finalize-qualification-dir.mjs <evidence-dir>");
  process.exit(1);
}
const dir = resolve(dirArg);

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function sha256Text(s) {
  return createHash("sha256").update(s).digest("hex");
}

function walk(d, acc = []) {
  for (const name of readdirSync(d)) {
    const full = join(d, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const repo = existsSync(join(here, "..", ".git")) ? resolve(join(here, "..")) : resolve(process.cwd());
const head = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();
const dirty = execSync("git status --porcelain -uall", { cwd: repo, encoding: "utf8" });
const dirtyTreeFingerprintAlgorithm = "sha256(utf8 of `git status --porcelain -uall`)";
const dirtyTreeFingerprint = sha256Text(dirty);

const logsDir = join(dir, "logs");
const logFiles = existsSync(logsDir) ? readdirSync(logsDir).filter((n) => n.endsWith(".log")) : [];
const summaryName = logFiles.find((n) => n.includes("orchestration-summary")) ?? "orchestration-summary.log";
const summary = existsSync(join(logsDir, summaryName)) ? readFileSync(join(logsDir, summaryName), "utf8") : "";
const orch = parseOrchestrationSummary(summary);

const logTexts = {};
const logHashesBefore = {};
for (const name of logFiles) {
  const full = join(logsDir, name);
  logTexts[name] = readFileSync(full, "utf8");
  logHashesBefore[name] = sha256File(full);
}

const aggregated = aggregateLogs(logTexts);
const shards = { ...orch.shards };
for (const shard of Object.keys(shards)) {
  for (const rep of shards[shard].repetitions) {
    const log =
      logFiles.find((n) => n.startsWith(`${shard}-`) && n.includes(`-r${rep.rep}.`)) ?? null;
    rep.log = log;
    if (log && aggregated.perLog[log]) {
      const parsed = aggregated.perLog[log];
      rep.exitCode = rep.exit;
      rep.repetitionResult = rep.result;
      rep.tests = parsed.totals;
      rep.projects = parsed.projects;
      rep.isolatedDb = parsed.isolatedDb;
      rep.runId = parsed.runId;
      rep.lastLineUndercounts = parsed.lastLineUndercounts;
      rep.lastPassedLineOnly = parsed.lastPassedLineOnly;
    }
  }
}

let playwrightVersion = null;
try {
  playwrightVersion = require(join(repo, "artifacts", "claimtagx", "node_modules", "@playwright", "test", "package.json")).version;
} catch {
  try {
    playwrightVersion = require(join(repo, "node_modules", "@playwright", "test", "package.json")).version;
  } catch {
    playwrightVersion = null;
  }
}

const lockPath = join(repo, "pnpm-lock.yaml");
const pnpmLockHash = existsSync(lockPath) ? sha256File(lockPath) : null;

const productionBuildHashes = {};
const distPublic = join(repo, "artifacts", "claimtagx", "dist", "public");
if (existsSync(distPublic)) {
  for (const f of walk(distPublic)) {
    const rel = relative(distPublic, f).replaceAll("\\", "/");
    if (/\.(js|css|html|map)$/.test(rel)) productionBuildHashes[rel] = sha256File(f);
  }
}

const firstLog = Object.values(aggregated.perLog)[0];
const distFromLog = firstLog?.dist ?? null;

const originalManifestPath = join(dir, "manifest.json");
const originalExists = existsSync(originalManifestPath);
const originalManifestSha256 = originalExists ? sha256File(originalManifestPath) : null;

const viewports =
  orch.browser === "firefox"
    ? ["firefox-320", "firefox-390", "firefox-768", "firefox-1024", "firefox-1440"]
    : orch.browser === "webkit"
      ? ["webkit-320", "webkit-390", "webkit-768", "webkit-1024", "webkit-1440"]
      : ["mobile-320", "mobile-390", "tablet-768", "desktop-1024", "desktop-1440"];

const endedAt = existsSync(join(logsDir, summaryName))
  ? statSync(join(logsDir, summaryName)).mtime.toISOString()
  : null;

const corrected = {
  schemaVersion: 2,
  supersedesOriginalManifest: originalExists,
  originalManifestPath: originalExists ? "manifest.json" : null,
  originalManifestSha256,
  auditGrade: false,
  auditGradeReason: originalExists
    ? "Corrected counts/metadata; original manifest.json retained and must not be treated as accurate test totals."
    : "Counts parsed per viewport; still not a frozen same-head qualification package.",
  kind: `${orch.browser}-contact-shard-qualification`,
  qualifying: orch.kind === "qualifying",
  diagnostic: orch.kind === "diagnostic",
  worktree: repo,
  branch: "cursor/3b23f5cb",
  headCommit: head,
  dirtyTreeFingerprintAlgorithm,
  dirtyTreeFingerprint,
  schemaHead: "0019_crm_staff_routing_attributes.sql",
  os: {
    platform: os.platform(),
    release: os.release(),
    type: os.type(),
    arch: os.arch(),
  },
  nodeVersion: process.version,
  pnpmLockHash,
  playwrightVersion,
  browser: {
    family: orch.browser,
    channel: orch.browser === "chromium" ? "chrome" : orch.browser,
    executablePath: null,
    version: null,
    revision: null,
    note: "Historical logs did not record executable path/version; fields are null rather than guessed.",
  },
  retries: orch.retries,
  viewports,
  siteMode: orch.siteMode,
  evidenceDir: dir,
  orchestrationSummary: `logs/${summaryName}`,
  startedAt: orch.startedAt,
  endedAt,
  databaseNames: [
    ...new Set(Object.values(aggregated.perLog).map((p) => p.isolatedDb).filter(Boolean)),
  ],
  distFromLog,
  productionBuildHashesAtFinalizeTime: productionBuildHashes,
  productionBuildHashNote:
    "Hashes of current dist/public at finalize time. Historical preview runs may have used a different build.",
  allShardsOk: orch.allShardsOk,
  hasShardFailures: orch.hasShardFailures,
  shards,
  testCountsPerLog: Object.fromEntries(
    Object.entries(aggregated.perLog).map(([name, p]) => [
      name,
      {
        projects: p.projects,
        totals: p.totals,
        lastPassedLineOnly: p.lastPassedLineOnly,
        lastLineUndercounts: p.lastLineUndercounts,
        isolatedDb: p.isolatedDb,
        runId: p.runId,
      },
    ]),
  ),
  aggregateTotals: aggregated.totals,
  logSha256BeforeManifest: logHashesBefore,
  note: "Log files were not modified. Original manifest.json is retained when present.",
  finalizedAt: new Date().toISOString(),
};

const outPath = originalExists ? join(dir, "manifest.corrected.json") : originalManifestPath;
if (!originalExists && existsSync(outPath)) {
  console.error(`refusing to overwrite ${outPath}`);
  process.exit(1);
}
if (originalExists && existsSync(outPath)) {
  console.error(`refusing to overwrite ${outPath}`);
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(corrected, null, 2));

const logHashesAfter = {};
let drift = false;
for (const name of logFiles) {
  logHashesAfter[name] = sha256File(join(logsDir, name));
  if (logHashesAfter[name] !== logHashesBefore[name]) drift = true;
}

mkdirSync(join(dir, "hashes"), { recursive: true });
const verifyName = originalExists ? "corrected-verify.json" : "verify.json";
const shaName = originalExists ? "corrected-sha256.json" : "sha256.json";
const allFiles = walk(dir).filter((p) => !p.replaceAll("\\", "/").includes("/hashes/"));
const hashes = {};
for (const f of allFiles) {
  hashes[relative(dir, f).replaceAll("\\", "/")] = sha256File(f);
}
writeFileSync(join(dir, "hashes", shaName), JSON.stringify({ hashes, logIntegrityOk: !drift }, null, 2));
writeFileSync(
  join(dir, "hashes", verifyName),
  JSON.stringify(
    {
      logIntegrityOk: !drift,
      logHashesAfter,
      correctedManifestSha256: sha256File(outPath),
      originalManifestSha256,
      originalManifestUntouched: originalExists
        ? sha256File(originalManifestPath) === originalManifestSha256
        : true,
    },
    null,
    2,
  ),
);

if (drift) {
  console.error("LOG INTEGRITY FAIL: a log file changed while writing the manifest");
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      dir,
      outPath,
      superseded: originalExists,
      allOk: orch.allShardsOk,
      aggregateTotals: aggregated.totals,
      logIntegrityOk: true,
    },
    null,
    2,
  ),
);
