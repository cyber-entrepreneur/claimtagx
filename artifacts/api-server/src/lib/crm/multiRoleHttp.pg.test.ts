import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ROLE_PERMISSIONS } from "./rbac.ts";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("multi-role HTTP tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

async function listenApp(): Promise<{ server: Server; base: string }> {
  process.env.CRM_HTTP_TEST_AUTH = "true";
  process.env.NODE_ENV = "development";
  const { default: app } = await import("../../app.ts");
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

describe("multi-role admin HTTP journeys (local auth; Clerk BLOCKED)", () => {
  it("owner/admin/manager/agent/analyst/unauthorized matrix on representative surfaces", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmContactsTable, crmInquiriesTable, crmConversationsTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);

    async function staff(role: keyof typeof ROLE_PERMISSIONS, name: string) {
      const email = `${name}.${suffix}@example.com`;
      const [row] = await db
        .insert(crmStaffTable)
        .values({
          email,
          emailNormalized: email,
          name,
          role,
          permissions: [],
          status: "active",
        })
        .returning();
      return row!;
    }

    const owner = await staff("owner", "mr-owner");
    const admin = await staff("admin", "mr-admin");
    const manager = await staff("admin", "mr-manager"); // manager uses admin permission set locally until distinct role exists
    const agent = await staff("sales", "mr-agent");
    const analyst = await staff("analyst", "mr-analyst");
    const unauthorizedId = randomUUID();

    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "MR",
        lastName: "Contact",
        jobTitle: "Buyer",
        email: `mr.c.${suffix}@example.com`,
        emailNormalized: `mr.c.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-2099-M${suffix.slice(0, 5).toUpperCase()}`,
        contactId: contact!.id,
        inquiryType: "sales",
        status: "NEW",
      })
      .returning();
    await db.insert(crmConversationsTable).values({ inquiryId: inquiry!.id, channel: "email" });

    const { server, base } = await listenApp();
    const hit = async (staffId: string | null, path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (staffId) headers.set("x-crm-test-staff-id", staffId);
      if (init.body) headers.set("content-type", "application/json");
      const res = await fetch(`${base}${path}`, { ...init, headers });
      return res.status;
    };

    try {
      assert.equal(await hit(owner.id, "/api/platform/me"), 200);
      assert.equal(await hit(admin.id, "/api/platform/me"), 200);
      assert.equal(await hit(manager.id, "/api/platform/me"), 200);
      assert.equal(await hit(agent.id, "/api/platform/me"), 200);
      assert.equal(await hit(analyst.id, "/api/platform/me"), 200);
      assert.equal(await hit(unauthorizedId, "/api/platform/me"), 401);
      assert.equal(await hit(null, "/api/platform/me"), 401);

      assert.equal(await hit(analyst.id, `/api/platform/contact/inquiries?limit=5`), 200);
      assert.equal(
        await hit(analyst.id, `/api/platform/contact/inquiries/${inquiry!.id}/assign`, {
          method: "POST",
          body: JSON.stringify({ staffId: agent.id }),
        }),
        403,
      );
      assert.equal(
        await hit(agent.id, `/api/platform/contact/inquiries/${inquiry!.id}/notes`, {
          method: "POST",
          body: JSON.stringify({ body: "Agent note for multi-role matrix." }),
        }),
        201,
      );
      assert.equal(await hit(analyst.id, "/api/platform/contact/exports", {
        method: "POST",
        body: JSON.stringify({ columns: ["reference"], filters: {} }),
      }), 403);
      assert.equal(await hit(owner.id, "/api/platform/contact/jobs/dead?limit=5"), 200);
      assert.equal(await hit(agent.id, "/api/platform/contact/jobs/dead?limit=5"), 403);
      assert.equal(await hit(admin.id, "/api/platform/contact/saved-views"), 200);
      assert.equal(
        await hit(analyst.id, "/api/platform/contact/notification-policy", {
          method: "PUT",
          body: JSON.stringify({ channels: ["in_app"], rationale: "should deny" }),
        }),
        403,
      );
      assert.equal(
        await hit(owner.id, "/api/platform/contact/retention-policy", {
          method: "PUT",
          body: JSON.stringify({ retainDays: 365, rationale: "owner retention draft" }),
        }),
        201,
      );
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });
});
