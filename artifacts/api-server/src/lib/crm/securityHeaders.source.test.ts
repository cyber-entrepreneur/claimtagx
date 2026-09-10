import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app.ts"), "utf8");

describe("API security headers (source)", () => {
  it("sets nosniff, frame deny, and a restrictive CSP", () => {
    assert.match(app, /X-Content-Type-Options/);
    assert.match(app, /nosniff/);
    assert.match(app, /X-Frame-Options/);
    assert.match(app, /DENY/);
    assert.match(app, /Content-Security-Policy/);
    assert.match(app, /frame-ancestors 'none'/);
  });
});
