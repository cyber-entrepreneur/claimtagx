import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("HTTP config tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
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

describe("live HTTP configuration governance", () => {
  it("enforces dual control, stale lock 409, publish, rollback, and test-auth origin checks", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmSlaPoliciesTable } = await import("@workspace/db");
    const [policy] = await db.select().from(crmSlaPoliciesTable).limit(1);
    assert.ok(policy);
    const suffix = randomUUID().slice(0, 8);
    const [author] = await db
      .insert(crmStaffTable)
      .values({
        email: `http.a.${suffix}@example.com`,
        emailNormalized: `http.a.${suffix}@example.com`,
        name: "HTTP Author",
        role: "admin",
        permissions: ["config.propose", "config.review", "config.publish"],
      })
      .returning();
    const [reviewer] = await db
      .insert(crmStaffTable)
      .values({
        email: `http.r.${suffix}@example.com`,
        emailNormalized: `http.r.${suffix}@example.com`,
        name: "HTTP Reviewer",
        role: "admin",
        permissions: ["config.propose", "config.review", "config.publish"],
      })
      .returning();
    const [sales] = await db
      .insert(crmStaffTable)
      .values({
        email: `http.s.${suffix}@example.com`,
        emailNormalized: `http.s.${suffix}@example.com`,
        name: "HTTP Sales",
        role: "sales",
        permissions: [],
      })
      .returning();
    assert.ok(author && reviewer && sales);
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
      const denied = await json("/api/platform/contact/config/changes", {
        method: "POST",
        staff: sales.id,
        body: JSON.stringify({
          entityType: "sla_policy",
          entityId: policy.id,
          afterValue: { firstResponseMinutes: policy.firstResponseMinutes + 3, name: policy.name },
        }),
      });
      assert.equal(denied.status, 403);
      const created = await json("/api/platform/contact/config/changes", {
        method: "POST",
        staff: author.id,
        body: JSON.stringify({
          entityType: "sla_policy",
          entityId: policy.id,
          afterValue: { firstResponseMinutes: policy.firstResponseMinutes + 3, name: policy.name },
          beforeValue: { firstResponseMinutes: policy.firstResponseMinutes, name: policy.name },
        }),
      });
      assert.equal(created.status, 201);
      const id = created.body.id as string;
      const submitted = await json(`/api/platform/contact/config/changes/${id}/submit_review`, {
        method: "POST",
        staff: author.id,
        body: JSON.stringify({ expectedLockVersion: created.body.lockVersion }),
      });
      assert.equal(submitted.status, 200);
      const stale = await json(`/api/platform/contact/config/changes/${id}/approve`, {
        method: "POST",
        staff: reviewer.id,
        body: JSON.stringify({ expectedLockVersion: 0 }),
      });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.code, "STALE_LOCK");
      const approved = await json(`/api/platform/contact/config/changes/${id}/approve`, {
        method: "POST",
        staff: reviewer.id,
        body: JSON.stringify({ expectedLockVersion: submitted.body.lockVersion }),
      });
      assert.equal(approved.status, 200);
      const published = await json(`/api/platform/contact/config/changes/${id}/publish`, {
        method: "POST",
        staff: reviewer.id,
        body: JSON.stringify({
          expectedLockVersion: approved.body.lockVersion,
          expectedPublishedVersion: 0,
        }),
      });
      let publishBody = published;
      if (published.status === 409 && typeof published.body.currentPublishedVersion === "number") {
        publishBody = await json(`/api/platform/contact/config/changes/${id}/publish`, {
          method: "POST",
          staff: reviewer.id,
          body: JSON.stringify({
            expectedLockVersion: approved.body.lockVersion,
            expectedPublishedVersion: published.body.currentPublishedVersion,
          }),
        });
      }
      assert.equal(publishBody.status, 200);
      const rolled = await json(`/api/platform/contact/config/changes/${id}/rollback`, {
        method: "POST",
        staff: reviewer.id,
        body: JSON.stringify({
          expectedLockVersion: publishBody.body.lockVersion,
          expectedPublishedVersion: publishBody.body.publishedVersion,
        }),
      });
      assert.equal(rolled.status, 200);
      const originDenied = await json("/api/platform/contact/config/changes", {
        method: "POST",
        staff: author.id,
        headers: { origin: "https://evil.example" },
        body: JSON.stringify({
          entityType: "sla_policy",
          entityId: policy.id,
          afterValue: { name: policy.name },
        }),
      });
      assert.ok(originDenied.status >= 400);
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });

  it("forbids the HTTP test auth harness in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.CRM_HTTP_TEST_AUTH = "true";
    const { requirePlatformAdmin } = await import("../../middlewares/requirePlatformAdmin.ts");
    const req = { headers: { "x-crm-test-staff-id": randomUUID() }, method: "GET" } as never;
    const res = { status() { return this; }, json() { return this; } } as never;
    let caught: unknown;
    await new Promise<void>((resolve) => {
      void requirePlatformAdmin(req, res, (err?: unknown) => {
        caught = err;
        resolve();
      });
    });
    process.env.NODE_ENV = prev;
    assert.ok(caught instanceof Error);
    assert.match((caught as Error).message, /forbidden in production/);
  });
});
