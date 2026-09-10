import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CONTACT_CRM_OPERATIONS } from "../../../../../lib/api-client-react/src/contact-crm.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const spec = readFileSync(join(root, "lib", "api-spec", "openapi-contact-crm.yaml"), "utf8");

describe("OpenAPI Contact CRM contract", () => {
  it("lists every client operation path", () => {
    for (const [id, op] of Object.entries(CONTACT_CRM_OPERATIONS)) {
      const escaped = op.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(spec, new RegExp(`operationId: ${id}`), id);
      assert.match(spec, new RegExp(escaped), id);
    }
  });

  it("has a client entry for every YAML operationId", () => {
    const ids = [...spec.matchAll(/operationId:\s+(\S+)/g)].map((m) => m[1]);
    assert.ok(ids.length >= 40);
    for (const id of ids) {
      assert.ok(id in CONTACT_CRM_OPERATIONS, id);
    }
  });

  it("declares auth, error, and pagination components", () => {
    // First-party session cookie scheme replaced the removed bearer scheme.
    assert.match(spec, /sessionCookie/);
    assert.doesNotMatch(spec, /[a-z]+Bearer/);
    assert.match(spec, /Unauthorized/);
    assert.match(spec, /x-permission/);
    assert.match(spec, /PageLimit|limit/);
  });

  it("has Orval-generated operations for every catalog id", () => {
    const generated = readFileSync(join(root, "lib", "api-client-react", "src", "contact-generated", "api.ts"), "utf8");
    for (const id of Object.keys(CONTACT_CRM_OPERATIONS)) {
      assert.match(generated, new RegExp(`export const ${id} =`), id);
    }
  });
});
