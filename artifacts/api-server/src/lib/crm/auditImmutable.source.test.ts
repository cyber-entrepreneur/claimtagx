import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const audit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "audit.ts"), "utf8");

describe("audit events are append-only", () => {
  it("inserts crm_audit_events and never updates them", () => {
    assert.match(audit, /crmAuditEventsTable\)\.values/);
    assert.equal(/\.update\(crmAuditEventsTable\)/.test(audit), false);
    assert.equal(/\.delete\(crmAuditEventsTable\)/.test(audit), false);
  });
});
