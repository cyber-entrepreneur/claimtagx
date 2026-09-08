import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "routes", "platformContact.ts"),
  "utf8",
);

describe("platform mutation routes declare permissions", () => {
  it("does not register a POST/PUT/DELETE /platform/contact handler without requirePermission (except auth)", () => {
    const blocks = src.split("router.");
    const mutations = blocks.filter((b) => /^(post|put|delete|patch)\(/.test(b.trim()));
    assert.ok(mutations.length > 5);
    for (const block of mutations) {
      const head = block.slice(0, 200);
      if (head.includes("/platform/auth/")) continue;
      if (!head.includes("/platform/")) continue;
      assert.match(block.slice(0, 400), /requirePermission\(/, head.split("\n")[0]);
    }
  });
});
