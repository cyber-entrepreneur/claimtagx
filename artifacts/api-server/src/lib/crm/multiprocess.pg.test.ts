import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("multi-process tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

const here = dirname(fileURLToPath(import.meta.url));

describe("multi-process CRM workers", () => {
  it("enforces claim exclusivity across two Node worker processes", async () => {
    requireIsolatedDb();
    // Repo-owned harness next to this test — never a gitignored tmp path.
    const harness = join(here, "dualWorkerHarness.ts");
    const cwd = join(here, "..", "..", "..");
    const result = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", harness], {
        env: process.env,
        cwd,
      });
      let out = "";
      child.stdout.on("data", (d) => {
        out += String(d);
      });
      child.stderr.on("data", (d) => {
        out += String(d);
      });
      child.on("close", (code) => resolve({ code, out }));
    });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /PASS dual-process SKIP LOCKED/);
  });
});
