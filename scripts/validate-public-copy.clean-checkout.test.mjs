import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const validator = join(here, "validate-public-copy.mjs");

function runOwnedDir() {
  return mkdtempSync(join(tmpdir(), "public-copy-clean-checkout-"));
}

function runValidator(env) {
  return spawnSync(process.execPath, [validator], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("public-copy validator clean-checkout evidence directory", () => {
  it("creates a missing run-owned evidence directory and writes the JSON", () => {
    const runDir = runOwnedDir();
    try {
      const outputDirectory = join(runDir, "tmp");
      assert.equal(existsSync(outputDirectory), false);

      const result = runValidator({ PUBLIC_COPY_EVIDENCE_DIR: outputDirectory });
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const outputFile = join(outputDirectory, "public-copy-expression-disposition.json");
      assert.equal(existsSync(outputDirectory), true);
      assert.equal(existsSync(outputFile), true);
      const parsed = JSON.parse(readFileSync(outputFile, "utf8"));
      assert.equal(parsed.engineering, "PASS");
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("still exits non-zero on engineering failure after creating the evidence directory", () => {
    const runDir = runOwnedDir();
    try {
      const outputDirectory = join(runDir, "tmp");
      const claimtagx = join(runDir, "claimtagx");
      mkdirSync(join(claimtagx, "src", "pages"), { recursive: true });
      writeFileSync(join(claimtagx, "index.html"), "<html><head></head><body></body></html>\n");
      writeFileSync(
        join(claimtagx, "src", "pages", "Home.tsx"),
        'export default function Home() {\n  return <p>Talk to sales</p>;\n}\n',
      );
      assert.equal(existsSync(outputDirectory), false);

      const result = runValidator({
        PUBLIC_COPY_EVIDENCE_DIR: outputDirectory,
        PUBLIC_COPY_CLAIMTAGX_ROOT: claimtagx,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Public-copy engineering FAIL/);

      const outputFile = join(outputDirectory, "public-copy-expression-disposition.json");
      assert.equal(existsSync(outputDirectory), true);
      assert.equal(existsSync(outputFile), true);
      const parsed = JSON.parse(readFileSync(outputFile, "utf8"));
      assert.equal(parsed.engineering, "FAIL");
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
