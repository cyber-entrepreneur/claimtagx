import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("HTTP RBAC tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
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

describe("HTTP RBAC matrix (CRM_HTTP_TEST_AUTH)", () => {
  it("denies analyst mutations and allows sales reply / admin DSAR", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmContactsTable, crmInquiriesTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);
    const [analyst] = await db
      .insert(crmStaffTable)
      .values({
        email: `rbac.a.${suffix}@example.com`,
        emailNormalized: `rbac.a.${suffix}@example.com`,
        name: "RBAC Analyst",
        role: "analyst",
        permissions: [],
      })
      .returning();
    const [sales] = await db
      .insert(crmStaffTable)
      .values({
        email: `rbac.s.${suffix}@example.com`,
        emailNormalized: `rbac.s.${suffix}@example.com`,
        name: "RBAC Sales",
        role: "sales",
        permissions: [],
      })
      .returning();
    const [admin] = await db
      .insert(crmStaffTable)
      .values({
        email: `rbac.adm.${suffix}@example.com`,
        emailNormalized: `rbac.adm.${suffix}@example.com`,
        name: "RBAC Admin",
        role: "admin",
        permissions: [],
      })
      .returning();
    assert.ok(analyst && sales && admin);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        email: `rbac.c.${suffix}@example.com`,
        emailNormalized: `rbac.c.${suffix}@example.com`,
        firstName: "Rbac",
        lastName: "Contact",
        jobTitle: "Buyer",
        country: "US",
      })
      .returning();
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-RBAC-${suffix}`,
        contactId: contact!.id,
        inquiryType: "sales",
        status: "NEW",
        assignedStaffId: sales.id,
        channel: "web",
      })
      .returning();
    assert.ok(inquiry);
    const { server, base } = await listenApp();
    const json = async (path: string, init: RequestInit & { staff?: string }) => {
      const headers = new Headers(init.headers);
      headers.set("content-type", "application/json");
      if (init.staff) headers.set("x-crm-test-staff-id", init.staff);
      const res = await fetch(`${base}${path}`, { ...init, headers });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    };
    try {
      const matrix: Array<{ staff: string; path: string; method: string; body?: unknown; expect: number }> = [
        {
          staff: analyst.id,
          path: `/api/platform/contact/inquiries/${inquiry.id}/reply`,
          method: "POST",
          body: { body: "analyst should not reply" },
          expect: 403,
        },
        {
          staff: analyst.id,
          path: "/api/platform/contact/dsar",
          method: "POST",
          body: { contactId: contact!.id, requestType: "export" },
          expect: 403,
        },
        {
          staff: sales.id,
          path: `/api/platform/contact/inquiries/${inquiry.id}/status`,
          method: "POST",
          body: { status: "IN_PROGRESS" },
          expect: 200,
        },
        {
          staff: sales.id,
          path: "/api/platform/contact/config/changes",
          method: "POST",
          body: { entityType: "sla_policy", entityId: randomUUID(), afterValue: {} },
          expect: 403,
        },
        {
          staff: admin.id,
          path: "/api/platform/contact/dsar",
          method: "GET",
          expect: 200,
        },
        {
          staff: analyst.id,
          path: "/api/platform/contact/analytics",
          method: "GET",
          expect: 200,
        },
      ];
      for (const row of matrix) {
        const res = await json(row.path, {
          method: row.method,
          staff: row.staff,
          body: row.body ? JSON.stringify(row.body) : undefined,
        });
        assert.equal(res.status, row.expect, `${row.method} ${row.path} as ${row.staff} → ${res.status} ${JSON.stringify(res.body)}`);
      }
      const foreign = await db
        .insert(crmInquiriesTable)
        .values({
          reference: `CTX-RBAC-F-${suffix}`,
          contactId: contact!.id,
          inquiryType: "general",
          status: "ASSIGNED",
          assignedStaffId: admin.id,
          channel: "web",
        })
        .returning();
      const denied = await json(`/api/platform/contact/inquiries/${foreign[0]!.id}/status`, {
        method: "POST",
        staff: sales.id,
        body: JSON.stringify({ status: "CLOSED" }),
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.code, "OBJECT_AUTH_DENIED");

      const bogusId = randomUUID();
      const bulk = await json("/api/platform/contact/inquiries/bulk-status", {
        method: "POST",
        staff: admin.id,
        body: JSON.stringify({ ids: [inquiry.id, bogusId], status: "TRIAGED", confirm: true }),
      });
      assert.equal(bulk.status, 200);
      assert.equal(bulk.body.updated, 1);
      assert.equal(bulk.body.failed?.length, 1);
      assert.equal(bulk.body.failed[0].code, "NOT_FOUND");
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });
});
