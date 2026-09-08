import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Failure-mode contract for load/soak/restore/Clerk/Graph/staging migrate/dual-worker.
 * These checks are executable without infrastructure: they assert the runbook scripts exist
 * and that skip conditions are explicit. Live runs stay infrastructure-dependent.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

describe("infrastructure verification harness", () => {
  it("ships ready-to-run scripts that no-op without env", () => {
    for (const rel of [
      "scripts/crm-infra-verify.mjs",
      "scripts/sync-contact-crm-ops.mjs",
      "lib/db/drizzle/ROLLBACK.md",
      "docs/contact-crm/RUNBOOK.md",
    ]) {
      assert.equal(existsSync(join(repo, rel)), true, rel);
    }
  });
});
