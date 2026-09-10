import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("Admin rate-limit tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("admin route rate limits", () => {
  it("returns 429 after CRM_ADMIN_RATE_MAX is exceeded for a staff+route key", async () => {
    requireIsolatedDb();
    process.env.CRM_HTTP_TEST_AUTH = "true";
    process.env.NODE_ENV = "development";
    process.env.CRM_ADMIN_RATE_MAX = "1";
    process.env.CRM_ADMIN_RATE_WINDOW_MS = "60000";
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);
    const [admin] = await db
      .insert(crmStaffTable)
      .values({
        email: `rate.adm.${suffix}@example.com`,
        emailNormalized: `rate.adm.${suffix}@example.com`,
        name: "Rate Admin",
        role: "admin",
        permissions: [],
      })
      .returning();
    assert.ok(admin);
    const { default: app } = await import("../../app.ts");
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${addr.port}`;
    try {
      const hit = async () => {
        const res = await fetch(`${base}/api/platform/contact/dsar`, {
          headers: { "x-crm-test-staff-id": admin.id },
        });
        return res.status;
      };
      assert.equal(await hit(), 200);
      assert.equal(await hit(), 429);
    } finally {
      delete process.env.CRM_ADMIN_RATE_MAX;
      delete process.env.CRM_ADMIN_RATE_WINDOW_MS;
      await closeIsolatedHttpServer(server);
    }
  });
});
