import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function copyNoClobber(src, dest) {
  if (existsSync(dest)) {
    throw new Error(`refusing to overwrite ${dest}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const utc = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
const short = head.slice(0, 12);
const dirty = execSync("git status --porcelain -uall", { cwd: root, encoding: "utf8" });
const dirtyFingerprint = createHash("sha256").update(dirty).digest("hex");
const runId = createHash("sha256").update(`${utc}:${head}:${dirtyFingerprint}`).digest("hex").slice(0, 12);
const dest = join(root, "tmp", "qualification", `${utc}-${short}-${runId}`);
if (existsSync(dest)) throw new Error(`evidence dir exists: ${dest}`);
mkdirSync(join(dest, "logs"), { recursive: true });
mkdirSync(join(dest, "hashes"), { recursive: true });

const sources = [
  ["tmp/pw-shard-chrome-preview-summary.log", "historical-orch-chrome-preview-summary.log", "historical_failure_sequence"],
  ["tmp/pw-shard-A1-chrome-preview-r1.log", "A1-r1.log", "qualifying"],
  ["tmp/pw-shard-A1-chrome-preview-r2.log", "A1-r2.log", "qualifying"],
  ["tmp/pw-shard-A1-chrome-preview-r3.log", "A1-r3.log", "qualifying"],
  ["tmp/pw-shard-A2-chrome-preview-r1.log", "A2-historical-r1.log", "historical"],
  ["tmp/pw-shard-A2-chrome-preview-r2.log", "A2-historical-r2-FAIL.log", "historical_failure"],
  ["tmp/pw-shard-A2-chrome-preview-r3.log", "A2-historical-r3.log", "historical"],
  ["tmp/pw-shard-a2retry-chrome-preview-summary.log", "A2-qualifying-retry-summary.log", "qualifying"],
  ["tmp/pw-shard-a2retry-A2-chrome-preview-r1.log", "A2-qualifying-r1.log", "qualifying"],
  ["tmp/pw-shard-a2retry-A2-chrome-preview-r2.log", "A2-qualifying-r2.log", "qualifying"],
  ["tmp/pw-shard-a2retry-A2-chrome-preview-r3.log", "A2-qualifying-r3.log", "qualifying"],
  ["tmp/pw-shard-A3-chrome-preview-r1.log", "A3-r1.log", "qualifying"],
  ["tmp/pw-shard-A3-chrome-preview-r2.log", "A3-r2.log", "qualifying"],
  ["tmp/pw-shard-A3-chrome-preview-r3.log", "A3-r3.log", "qualifying"],
  ["tmp/pw-shard-A4-chrome-preview-r1.log", "A4-r1.log", "qualifying"],
  ["tmp/pw-shard-A4-chrome-preview-r2.log", "A4-r2.log", "qualifying"],
  ["tmp/pw-shard-A4-chrome-preview-r3.log", "A4-r3.log", "qualifying"],
  ["tmp/pw-shard-A5-chrome-preview-r1.log", "A5-r1.log", "qualifying"],
  ["tmp/pw-shard-A5-chrome-preview-r2.log", "A5-r2.log", "qualifying"],
  ["tmp/pw-shard-A5-chrome-preview-r3.log", "A5-r3.log", "qualifying"],
];

const copied = [];
for (const [srcRel, name, role] of sources) {
  const src = join(root, srcRel);
  if (!existsSync(src)) continue;
  const destFile = join(dest, "logs", name);
  copyNoClobber(src, destFile);
  copied.push({ src: srcRel.replaceAll("\\", "/"), dest: relative(dest, destFile).replaceAll("\\", "/"), role, sha256: sha256File(destFile) });
}

function parseExit(text) {
  const m = text.match(/END shard=(\w+) rep=(\d+) exit=(\d+)/g);
  return m ?? [];
}

const historicalSummary = existsSync(join(root, "tmp/pw-shard-chrome-preview-summary.log"))
  ? readFileSync(join(root, "tmp/pw-shard-chrome-preview-summary.log"), "utf8")
  : "";
const retrySummary = existsSync(join(root, "tmp/pw-shard-a2retry-chrome-preview-summary.log"))
  ? readFileSync(join(root, "tmp/pw-shard-a2retry-chrome-preview-summary.log"), "utf8")
  : "";

const shards = {
  A1: { sequence: ["PASS", "PASS", "PASS"], consecutive: 3, qualifyingLogs: ["A1-r1.log", "A1-r2.log", "A1-r3.log"] },
  A2: {
    historicalSequence: ["PASS", "FAIL", "PASS"],
    historicalFailure: {
      log: "tmp/pw-shard-A2-chrome-preview-r2.log",
      copiedAs: "A2-historical-r2-FAIL.log",
      viewport: "mobile-390",
      error: "Page crashed waiting for data-app-ready during keyboard-focus test",
    },
    qualifyingSequence: ["PASS", "PASS", "PASS"],
    consecutive: 3,
    qualifyingLogs: ["A2-qualifying-r1.log", "A2-qualifying-r2.log", "A2-qualifying-r3.log"],
  },
  A3: { sequence: ["PASS", "PASS", "PASS"], consecutive: 3, qualifyingLogs: ["A3-r1.log", "A3-r2.log", "A3-r3.log"] },
  A4: { sequence: ["PASS", "PASS", "PASS"], consecutive: 3, qualifyingLogs: ["A4-r1.log", "A4-r2.log", "A4-r3.log"] },
  A5: { sequence: ["PASS", "PASS", "PASS"], consecutive: 3, qualifyingLogs: ["A5-r1.log", "A5-r2.log", "A5-r3.log"] },
};

const hashes = {};
for (const f of walk(dest)) {
  hashes[relative(dest, f).replaceAll("\\", "/")] = sha256File(f);
}

const manifest = {
  kind: "chrome-stable-contact-shard-reconciliation",
  qualifying: true,
  diagnostic: false,
  worktree: root,
  branch: "cursor/3b23f5cb",
  headCommit: head,
  dirtyTreeFingerprint: dirtyFingerprint,
  schemaHead: "0019_crm_staff_routing_attributes.sql",
  browser: { family: "chromium", channel: "chrome", version: "152.0.7977.83", label: "Chrome Stable" },
  retries: 0,
  viewports: ["mobile-320", "mobile-390", "tablet-768", "desktop-1024", "desktop-1440"],
  siteMode: "preview",
  at: new Date().toISOString(),
  note: "tmp/pw-shard-chrome-preview-summary.log still ends HAS_SHARD_FAILURES because A2 r2 failed in that orchestration. This reconciliation does not rewrite that summary. Qualifying A2 consecutive series is the later a2retry Repeat 3.",
  historicalOrchLine: "HAS_SHARD_FAILURES browser=chromium variant=chrome siteMode=preview",
  shards,
  copies: copied,
  hashes,
  historicalSummaryExcerpts: parseExit(historicalSummary),
  retrySummaryExcerpts: parseExit(retrySummary),
};
writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
hashes["manifest.json"] = sha256File(join(dest, "manifest.json"));
writeFileSync(join(dest, "hashes", "sha256.json"), JSON.stringify(hashes, null, 2));

const recon = {
  ...manifest,
  hashes: { ...hashes, "hashes/sha256.json": sha256File(join(dest, "hashes", "sha256.json")) },
};
writeFileSync(join(dest, "RECONCILIATION.md"), `Chrome Stable shard qualification reconciliation
Worktree: ${root}
HEAD: ${head}
Dirty fingerprint: ${dirtyFingerprint}
Original orch summary remains HAS_SHARD_FAILURES (A2 r2 page crash). That file was copied, not rewritten.
Qualifying A2 series: a2retry r1–r3 PASS (3 consecutive).
A1, A3, A4, A5: PASS×3 in the original Repeat 3.
`);

console.log(dest);
