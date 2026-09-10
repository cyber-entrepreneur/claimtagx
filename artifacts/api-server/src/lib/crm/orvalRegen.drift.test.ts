import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { CONTACT_CRM_OPERATIONS } from "../../../../../lib/api-client-react/src/contact-crm.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const orvalBin = join(root, "lib", "api-spec", "node_modules", "orval", "dist", "bin", "orval.mjs");
const config = join(root, "lib", "api-spec", "orval.config.mjs");
const generatedApi = join(root, "lib", "api-client-react", "src", "contact-generated", "api.ts");
const generatedSchemas = join(root, "lib", "api-client-react", "src", "contact-generated", "api.schemas.ts");

function hashPair(): string {
  const h = createHash("sha256");
  // Normalize CRLF so Windows/Unix regenerations compare equal.
  h.update(readFileSync(generatedApi, "utf8").replace(/\r\n/g, "\n"));
  h.update(readFileSync(generatedSchemas, "utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex");
}

describe("Orval Contact CRM clean regeneration", () => {
  it("keeps CONTACT_CRM_OPERATIONS as OpenAPI metadata aligned with generated functions", () => {
    assert.ok(existsSync(generatedApi), "contact-generated/api.ts must exist");
    const api = readFileSync(generatedApi, "utf8");
    for (const id of Object.keys(CONTACT_CRM_OPERATIONS)) {
      assert.match(api, new RegExp(`export const ${id} =`), id);
    }
  });

  it("is deterministic across a clean regeneration", { skip: !existsSync(orvalBin) }, () => {
    const before = hashPair();
    const run = spawnSync(
      process.execPath,
      [orvalBin, "--config", config, "--project", "contact-crm-client-react"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const after = hashPair();
    assert.equal(after, before);
  });
});
