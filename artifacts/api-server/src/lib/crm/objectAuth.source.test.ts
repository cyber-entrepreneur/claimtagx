import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "routes", "platformContact.ts"),
  "utf8",
);

describe("object-level authorization", () => {
  it("scopes saved-view mutations to the authenticated staff id", () => {
    assert.match(src, /eq\(crmSavedViewsTable.staffId, req.platformStaff!.id\)/);
    assert.equal((src.match(/eq\(crmSavedViewsTable.staffId/g) ?? []).length >= 4, true);
  });

  it("enforces inquiry object auth on mutate routes and keyset cursors", () => {
    assert.match(src, /assertInquiryAccess/);
    assert.match(src, /encodeInquiryCursor|decodeInquiryCursor|nextCursor/);
    assert.match(src, /succeeded, failed/);
    assert.match(src, /contacts\/duplicates/);
  });
});
