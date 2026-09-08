import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const adminRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "claimtagx",
  "src",
  "pages",
  "admin",
);

describe("InquiryWorkspace presence + locks (source)", () => {
  it("contains inquiry-presence UI and locks/acquire calls", () => {
    const workspace = readFileSync(join(adminRoot, "InquiryWorkspace.tsx"), "utf8");
    assert.match(workspace, /data-testid="inquiry-presence"/);
    assert.match(workspace, /acquirePlatformRecordLock|locks\/acquire/);
  });
});
