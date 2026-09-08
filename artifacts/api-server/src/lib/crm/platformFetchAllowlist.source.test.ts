import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const claimtagxSrc = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "claimtagx", "src");
const registryPath = join(claimtagxSrc, "lib", "platformManualTransport.registry.ts");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

function approvedLiterals(): Set<string> {
  const src = readFileSync(registryPath, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/operation:\s*"([^"]+)"/g)) {
    const op = m[1]!;
    const path = op.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, "");
    out.add(path);
    const bare = path.replace(/\?.*$/, "");
    out.add(bare);
  }
  return out;
}

describe("generated-client adoption gate", () => {
  it("fails on leftover platformCall wrappers", () => {
    const offenders: string[] = [];
    for (const file of walk(claimtagxSrc)) {
      const rel = relative(claimtagxSrc, file).replaceAll("\\", "/");
      if (rel === "lib/platformManualTransport.registry.ts") continue;
      const src = readFileSync(file, "utf8");
      if (src.includes("platformCall")) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `platformCall still present: ${offenders.join(", ")}`);
  });

  it("forbids leftover platformFetch helper usage", () => {
    const offenders: string[] = [];
    for (const file of walk(claimtagxSrc)) {
      const rel = relative(claimtagxSrc, file).replaceAll("\\", "/");
      if (rel === "lib/platformManualTransport.registry.ts") continue;
      const src = readFileSync(file, "utf8");
      if (src.includes("platformFetch")) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `platformFetch still present: ${offenders.join(", ")}`);
  });

  it("fails on handwritten fetch() of CRM HTTP paths", () => {
    const offenders: string[] = [];
    for (const file of walk(claimtagxSrc)) {
      const rel = relative(claimtagxSrc, file).replaceAll("\\", "/");
      if (rel === "lib/platformManualTransport.registry.ts") continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bfetch\s*\(\s*[`'"](\/api\/(?:platform|contact)\/[^`'"]+)/g)) {
        offenders.push(`${rel}: fetch(${m[1]})`);
      }
    }
    assert.deepEqual(offenders, [], `handwritten CRM fetch calls:\n${offenders.join("\n")}`);
  });

  it("fails on unapproved handwritten /api/platform/ literals", () => {
    const approved = approvedLiterals();
    const offenders: string[] = [];
    for (const file of walk(claimtagxSrc)) {
      const rel = relative(claimtagxSrc, file).replaceAll("\\", "/");
      if (rel === "lib/platformManualTransport.registry.ts") continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/["'`](\/api\/platform\/[^"'`]+)["'`]/g)) {
        const lit = m[1]!;
        const ok = [...approved].some((a) => lit === a || lit.startsWith(`${a}?`) || a.includes("{id}") && new RegExp("^" + a.replace("{id}", "[^/?]+") + "(\\?.*)?$").test(lit));
        if (!ok) offenders.push(`${rel}: ${lit}`);
      }
    }
    assert.deepEqual(offenders, [], `unapproved platform URL literals:\n${offenders.join("\n")}`);
  });
});
