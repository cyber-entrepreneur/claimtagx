import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "queue.ts"), "utf8");

describe("job claim SQL", () => {
  it("uses SKIP LOCKED and lease expiry reclaim", () => {
    assert.match(sql, /claim_generation = j.claim_generation \+ 1/);
    assert.match(sql, /payload->>'_ck'/);
    assert.match(sql, /FOR UPDATE SKIP LOCKED/);
    assert.match(sql, /lease_expires_at/);
    assert.match(sql, /status = 'running'/);
    assert.match(sql, /lease_expires_at < NOW\(\)/);
    assert.match(sql, /prev_status = 'pending'/);
    assert.match(sql, /payload->>'e2eRunId'/);
    assert.match(sql, /THEN 1 ELSE 0 END/);
  });
});
