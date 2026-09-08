import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("marketing HTTP tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
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

describe("marketing CMS HTTP (CRM_HTTP_TEST_AUTH)", () => {
  it("enforces transition permissions, reconcile-publish, and publish-failures listing", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const {
      db,
      crmStaffTable,
      crmMarketingDocumentsTable,
      crmMarketingVersionsTable,
    } = await import("@workspace/db");

    const suffix = randomUUID().slice(0, 8);
    const [author] = await db
      .insert(crmStaffTable)
      .values({
        email: `mhttp.a.${suffix}@example.com`,
        emailNormalized: `mhttp.a.${suffix}@example.com`,
        name: "HTTP Author",
        role: "admin",
        permissions: ["marketing.propose", "marketing.read"],
      })
      .returning();
    const [publisher] = await db
      .insert(crmStaffTable)
      .values({
        email: `mhttp.p.${suffix}@example.com`,
        emailNormalized: `mhttp.p.${suffix}@example.com`,
        name: "HTTP Publisher",
        role: "admin",
        permissions: ["marketing.publish", "marketing.read"],
      })
      .returning();
    const [sales] = await db
      .insert(crmStaffTable)
      .values({
        email: `mhttp.s.${suffix}@example.com`,
        emailNormalized: `mhttp.s.${suffix}@example.com`,
        name: "HTTP Sales",
        role: "sales",
        permissions: [],
      })
      .returning();
    assert.ok(author && publisher && sales);

    const slug = `http-cms-${suffix}`;
    const [doc] = await db
      .insert(crmMarketingDocumentsTable)
      .values({ slug, contentType: "page" })
      .returning();
    const [enDraft] = await db
      .insert(crmMarketingVersionsTable)
      .values({
        documentId: doc!.id,
        locale: "en",
        version: 1,
        status: "approved",
        title: "Home EN",
        summary: "Summary",
        body: { hero: "hello" },
        seoTitle: "SEO EN",
        seoDescription: "Desc EN",
        authorStaffId: author.id,
        reviewerStaffId: author.id,
        lockVersion: 1,
      })
      .returning();
    const [arPublished] = await db
      .insert(crmMarketingVersionsTable)
      .values({
        documentId: doc!.id,
        locale: "ar",
        version: 1,
        status: "published",
        title: "Home AR",
        summary: "ملخص",
        body: { hero: "ar" },
        seoTitle: "SEO AR",
        seoDescription: "Desc AR",
        authorStaffId: author.id,
        publisherStaffId: publisher.id,
        publishedAt: new Date(),
      })
      .returning();
    assert.ok(enDraft && arPublished);

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
      const salesPublish = await json(`/api/platform/marketing/versions/${enDraft.id}/transition`, {
        method: "POST",
        staff: sales.id,
        body: JSON.stringify({ transition: "publish", expectedLockVersion: 1 }),
      });
      assert.equal(salesPublish.status, 403, "sales must not publish via HTTP");

      const authorPublish = await json(`/api/platform/marketing/versions/${enDraft.id}/transition`, {
        method: "POST",
        staff: author.id,
        body: JSON.stringify({ transition: "publish", expectedLockVersion: 1 }),
      });
      assert.equal(authorPublish.status, 403, "author without marketing.publish must not publish");

      const published = await json(`/api/platform/marketing/versions/${enDraft.id}/transition`, {
        method: "POST",
        staff: publisher.id,
        body: JSON.stringify({ transition: "publish", expectedLockVersion: 1 }),
      });
      assert.equal(published.status, 200, JSON.stringify(published.body));
      assert.equal(published.body.version?.status, "published");

      process.env.CRM_MARKETING_FAIL_CACHE = "1";
      try {
        await json(`/api/platform/marketing/versions/${enDraft.id}/reconcile-publish`, {
          method: "POST",
          staff: publisher.id,
          body: JSON.stringify({ kind: "cache" }),
        });
      } finally {
        delete process.env.CRM_MARKETING_FAIL_CACHE;
      }

      const failures = await json(`/api/platform/marketing/versions/${enDraft.id}/publish-failures`, {
        method: "GET",
        staff: publisher.id,
      });
      assert.equal(failures.status, 200);
      assert.ok(Array.isArray(failures.body.failures));

      const reconciled = await json(`/api/platform/marketing/versions/${enDraft.id}/reconcile-publish`, {
        method: "POST",
        staff: publisher.id,
        body: JSON.stringify({ kind: "cache" }),
      });
      assert.equal(reconciled.status, 200);
      assert.equal(reconciled.body.result?.cache, "ok");

      const salesReconcile = await json(`/api/platform/marketing/versions/${enDraft.id}/reconcile-publish`, {
        method: "POST",
        staff: sales.id,
        body: JSON.stringify({ kind: "all" }),
      });
      assert.equal(salesReconcile.status, 403);

      const rollbackDenied = await json(`/api/platform/marketing/versions/${enDraft.id}/rollback`, {
        method: "POST",
        staff: sales.id,
      });
      assert.equal(rollbackDenied.status, 403);

      const rollback = await json(`/api/platform/marketing/versions/${enDraft.id}/rollback`, {
        method: "POST",
        staff: author.id,
      });
      assert.equal(rollback.status, 201);
      assert.equal(rollback.body.version?.status, "draft");
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });

  it("enforces dual-control draft, reject, second-person approve, and stale lock", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);
    const [author] = await db
      .insert(crmStaffTable)
      .values({
        email: `mhttp.da.${suffix}@example.com`,
        emailNormalized: `mhttp.da.${suffix}@example.com`,
        name: "HTTP Dual Author",
        role: "admin",
        permissions: ["marketing.propose", "marketing.read"],
      })
      .returning();
    const [reviewer] = await db
      .insert(crmStaffTable)
      .values({
        email: `mhttp.dr.${suffix}@example.com`,
        emailNormalized: `mhttp.dr.${suffix}@example.com`,
        name: "HTTP Dual Reviewer",
        role: "admin",
        permissions: ["marketing.review", "marketing.read"],
      })
      .returning();
    assert.ok(author && reviewer);
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
      const created = await json("/api/platform/marketing/documents", {
        method: "POST",
        staff: author.id,
        body: JSON.stringify({
          slug: `dual-${suffix}`,
          locale: "en",
          title: "Dual EN",
          summary: "s",
          seoTitle: "SEO Dual",
          seoDescription: "Desc Dual",
          body: { hero: "ok" },
        }),
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const versionId = created.body.version?.id as string;
      let lock = created.body.version?.lockVersion as number;

      const submitted = await json(`/api/platform/marketing/versions/${versionId}/transition`, {
        method: "POST",
        staff: author.id,
        body: JSON.stringify({ transition: "submit_review", expectedLockVersion: lock }),
      });
      assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
      lock = submitted.body.version?.lockVersion;

      const selfApprove = await json(`/api/platform/marketing/versions/${versionId}/transition`, {
        method: "POST",
        staff: author.id,
        body: JSON.stringify({ transition: "approve", expectedLockVersion: lock }),
      });
      assert.equal(selfApprove.status, 403);

      const rejected = await json(`/api/platform/marketing/versions/${versionId}/transition`, {
        method: "POST",
        staff: reviewer.id,
        body: JSON.stringify({ transition: "reject", expectedLockVersion: lock, reason: "needs rewrite" }),
      });
      assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
      assert.equal(rejected.body.version?.status, "archived");

      const second = await json("/api/platform/marketing/documents", {
        method: "POST",
        staff: author.id,
        body: JSON.stringify({
          slug: `dual-${suffix}`,
          locale: "en",
          title: "Dual EN v2",
          summary: "s",
          seoTitle: "SEO Dual 2",
          seoDescription: "Desc Dual 2",
          body: { hero: "ok2" },
        }),
      });
      assert.equal(second.status, 201, JSON.stringify(second.body));
      const v2 = second.body.version?.id as string;
      let lock2 = second.body.version?.lockVersion as number;

      const resubmit = await json(`/api/platform/marketing/versions/${v2}/transition`, {
        method: "POST",
        staff: author.id,
        body: JSON.stringify({ transition: "submit_review", expectedLockVersion: lock2 }),
      });
      assert.equal(resubmit.status, 200);
      lock2 = resubmit.body.version?.lockVersion;

      const stale = await json(`/api/platform/marketing/versions/${v2}/transition`, {
        method: "POST",
        staff: reviewer.id,
        body: JSON.stringify({ transition: "approve", expectedLockVersion: lock2 + 9 }),
      });
      assert.equal(stale.status, 409);

      const approved = await json(`/api/platform/marketing/versions/${v2}/transition`, {
        method: "POST",
        staff: reviewer.id,
        body: JSON.stringify({ transition: "approve", expectedLockVersion: lock2 }),
      });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.version?.status, "approved");
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });
});

describe("marketing audit append-only (PostgreSQL)", () => {
  it("rejects UPDATE/DELETE on crm_marketing_audit rows", async () => {
    requireIsolatedDb();
    const { db, crmMarketingDocumentsTable, crmMarketingVersionsTable, crmMarketingAuditTable } = await import(
      "@workspace/db"
    );
    const suffix = randomUUID().slice(0, 8);
    const [doc] = await db
      .insert(crmMarketingDocumentsTable)
      .values({ slug: `audit-immut-${suffix}`, contentType: "page" })
      .returning();
    const [version] = await db
      .insert(crmMarketingVersionsTable)
      .values({
        documentId: doc!.id,
        locale: "en",
        version: 1,
        status: "draft",
        title: "Audit",
        summary: "s",
        body: {},
        seoTitle: "SEO",
        seoDescription: "Desc",
        authorStaffId: null,
      })
      .returning();
    const [audit] = await db
      .insert(crmMarketingAuditTable)
      .values({
        documentId: doc!.id,
        versionId: version!.id,
        action: "marketing.create_draft",
        afterValue: { test: true },
      })
      .returning();
    assert.ok(audit);

    await assert.rejects(async () => {
      await db
        .update(crmMarketingAuditTable)
        .set({ action: "tampered" })
        .where(eq(crmMarketingAuditTable.id, audit!.id));
    });

    await assert.rejects(async () => {
      await db.delete(crmMarketingAuditTable).where(eq(crmMarketingAuditTable.id, audit!.id));
    });
  });
});
