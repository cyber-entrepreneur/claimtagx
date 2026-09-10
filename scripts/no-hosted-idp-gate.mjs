#!/usr/bin/env node
/**
 * Fails the build if the removed hosted identity provider creeps back into
 * active ClaimTagX surfaces.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const removedProvider = ["c", "l", "e", "r", "k"].join("");
const retiredStaffIdColumn = [removedProvider, "_user_id"].join("");
const retiredStaffIndex = ["crm_staff_", removedProvider, "_uniq"].join("");
const removedProviderRe = new RegExp(removedProvider, "i");
const removedScopedPackageRe = new RegExp(`@${removedProvider}/`, "i");

const ACTIVE_SOURCE_ROOTS = [
  join(repoRoot, "artifacts", "api-server"),
  join(repoRoot, "artifacts", "claimtagx", "src"),
  join(repoRoot, "artifacts", "handler-app", "src"),
  join(repoRoot, "scripts"),
];

const violations = [];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry === "node_modules" ||
      entry === ".git" ||
      entry === "dist" ||
      entry === "test-dist" ||
      entry === "coverage" ||
      entry === ".turbo"
    ) {
      continue;
    }
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function rel(file) {
  return relative(repoRoot, file).replace(/\\/g, "/");
}

function isTextFile(file) {
  return /\.(ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|md|sql)$/i.test(file);
}

function isHistoricalSql(file) {
  const r = rel(file);
  return /^lib\/db\/drizzle\/(000[0-9]|001[0-9]|002[0-2])_.*\.sql$/.test(r);
}

function isFinalIdentitySql(file) {
  return /^lib\/db\/drizzle\/0023_remove_.*_identity\.sql$/.test(rel(file));
}

function checkText(file, scope) {
  if (!existsSync(file) || !isTextFile(file) || isHistoricalSql(file)) return;
  const text = readFileSync(file, "utf8");
  const r = rel(file);

  if (isFinalIdentitySql(file)) {
    const badLines = text
      .split(/\r?\n/)
      .map((line, i) => ({ line, number: i + 1 }))
      .filter(({ line }) => removedProviderRe.test(line))
      .filter(({ line }) => !new RegExp(`DROP\\b.*${retiredStaffIdColumn}`, "i").test(line))
      .filter(({ line }) => !new RegExp(`\\b${retiredStaffIndex}\\b`, "i").test(line));
    for (const hit of badLines) {
      violations.push(`${r}:${hit.number} contains removed provider text outside the allowed final-drop lines`);
    }
    return;
  }

  if (removedProviderRe.test(text)) {
    violations.push(`${r} contains removed provider text (${scope})`);
  }
}

function checkPackageJson(file) {
  const text = readFileSync(file, "utf8");
  const r = rel(file);
  if (removedProviderRe.test(text)) {
    violations.push(`${r} contains removed provider text`);
  }
  try {
    const pkg = JSON.parse(text);
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const deps = pkg[field] ?? {};
      for (const name of Object.keys(deps)) {
        if (removedScopedPackageRe.test(name)) {
          violations.push(`${r} ${field} declares removed hosted identity dependency: ${name}`);
        }
      }
    }
  } catch (err) {
    violations.push(`could not parse ${r}: ${err.message}`);
  }
}

const filesToScan = new Set();

for (const root of ACTIVE_SOURCE_ROOTS) {
  if (!existsSync(root)) continue;
  const st = statSync(root);
  if (st.isDirectory()) {
    for (const file of walk(root)) filesToScan.add(file);
  }
}

const libRoot = join(repoRoot, "lib");
if (existsSync(libRoot)) {
  for (const entry of readdirSync(libRoot)) {
    const root = join(libRoot, entry);
    if (!statSync(root).isDirectory()) continue;
    for (const file of walk(root)) filesToScan.add(file);
  }
}

for (const file of walk(repoRoot)) {
  const r = rel(file);
  if (r.endsWith("package.json")) {
    checkPackageJson(file);
    continue;
  }
  if (r === "pnpm-lock.yaml") {
    const text = readFileSync(file, "utf8");
    if (removedScopedPackageRe.test(text)) {
      violations.push(`${r} catalogs removed hosted identity packages`);
    }
    continue;
  }
  if (/^lib\/api-spec\/.*\.ya?ml$/i.test(r)) filesToScan.add(file);
  if (/^lib\/api-(zod|client-react)\/src\/contact-generated\//.test(r)) filesToScan.add(file);
  if (
    /^docs\//.test(r) &&
    /(ENV_INVENTORY|PRODUCTION_READINESS|RUNBOOK|Railway|Cloudflare|DEPLOY|OPERATIONS)/i.test(r)
  ) {
    filesToScan.add(file);
  }
  if (r === "lib/api-spec/openapi-contact-crm.README.md") filesToScan.add(file);
}

for (const file of filesToScan) {
  checkText(file, "active surface");
}

if (violations.length > 0) {
  console.error("identity-provider gate: FAILED\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n${violations.length} violation(s). Remove hosted identity-provider residue.`);
  process.exit(1);
}

console.log("identity-provider gate: OK");
