import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const app = readFileSync(join(root, "app.ts"), "utf8");
const admin = readFileSync(join(root, "middlewares", "requirePlatformAdmin.ts"), "utf8");

describe("CORS and CSRF share corsOrigin policy", () => {
  it("app CORS and cookie CSRF use isCredentialedOriginAllowed", () => {
    assert.match(app, /from "\.\/lib\/crm\/corsOrigin"/);
    assert.match(app, /corsOriginDelegate/);
    assert.match(app, /isCredentialedOriginAllowed/);
    assert.match(app, /CSRF origin rejected/);
  });

  it("platform admin origin check uses the same helper", () => {
    assert.match(admin, /isCredentialedOriginAllowed/);
    assert.equal(admin.includes("allowed.add(\"http://localhost:5173\")"), false);
  });
});
