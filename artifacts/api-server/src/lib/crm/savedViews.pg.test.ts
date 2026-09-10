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
    throw new Error("saved view tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
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

async function makeStaff(name: string) {
  const { db, crmStaffTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [staff] = await db
    .insert(crmStaffTable)
    .values({
      email: `${name}.${suffix}@example.com`,
      emailNormalized: `${name}.${suffix}@example.com`,
      name,
      role: "sales",
      permissions: ["inquiries.view"],
    })
    .returning();
  assert.ok(staff);
  return staff!;
}

describe("saved views + advanced inquiry search (PostgreSQL HTTP)", () => {
  it("scopes views to staff, supports default view, and filters inquiries by tag/priority", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const {
      db,
      crmContactsTable,
      crmInquiriesTable,
      crmTagsTable,
      crmInquiryTagsTable,
      crmSavedViewsTable,
    } = await import("@workspace/db");

    const owner = await makeStaff("sv-owner");
    const other = await makeStaff("sv-other");
    const suffix = randomUUID().slice(0, 8);

    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Search",
        lastName: "Target",
        jobTitle: "Buyer",
        email: `sv.${suffix}@example.com`,
        emailNormalized: `sv.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [tagged] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-SV-T${suffix.slice(0, 5).toUpperCase()}`,
        contactId: contact!.id,
        inquiryType: "sales",
        status: "NEW",
        priority: "urgent",
      })
      .returning();
    const [plain] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-SV-P${suffix.slice(0, 5).toUpperCase()}`,
        contactId: contact!.id,
        inquiryType: "general",
        status: "NEW",
        priority: "normal",
      })
      .returning();
    assert.ok(tagged && plain);

    const [tag] = await db
      .insert(crmTagsTable)
      .values({ slug: `sv-tag-${suffix}`, label: `SV Tag ${suffix}` })
      .returning();
    await db.insert(crmInquiryTagsTable).values({ inquiryId: tagged!.id, tagId: tag!.id });

    const { server, base } = await listenApp();
    const json = async (path: string, init: RequestInit & { staff?: string }) => {
      const headers = new Headers(init.headers);
      if (init.body) headers.set("content-type", "application/json");
      if (init.staff) headers.set("x-crm-test-staff-id", init.staff);
      const res = await fetch(`${base}${path}`, { ...init, headers });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    };

    try {
      const created = await json("/api/platform/contact/saved-views", {
        method: "POST",
        staff: owner.id,
        body: JSON.stringify({
          name: "Urgent sales",
          filters: { priority: "urgent", inquiryType: "sales" },
          isDefault: true,
          scope: "personal",
        }),
      });
      assert.equal(created.status, 201);
      const viewId = created.body.id as string;

      const second = await json("/api/platform/contact/saved-views", {
        method: "POST",
        staff: owner.id,
        body: JSON.stringify({
          name: "General inbox",
          filters: { inquiryType: "general" },
          isDefault: true,
        }),
      });
      assert.equal(second.status, 201);

      const views = await json("/api/platform/contact/saved-views", { method: "GET", staff: owner.id });
      assert.equal(views.status, 200);
      const list = views.body as Array<{ id: string; isDefault: boolean }>;
      assert.equal(list.filter((v) => v.isDefault).length, 1);
      assert.equal(list.find((v) => v.isDefault)?.id, second.body.id);

      const foreignGet = await json(`/api/platform/contact/saved-views/${viewId}`, {
        method: "GET",
        staff: other.id,
      });
      assert.equal(foreignGet.status, 404);

      const tagSearch = await json(
        `/api/platform/contact/inquiries?tag=${encodeURIComponent(tag!.slug)}&limit=50`,
        { method: "GET", staff: owner.id },
      );
      assert.equal(tagSearch.status, 200);
      const tagIds = (tagSearch.body.items as Array<{ id: string }>).map((i) => i.id);
      assert.ok(tagIds.includes(tagged!.id));
      assert.equal(tagIds.includes(plain!.id), false);

      const prioritySearch = await json("/api/platform/contact/inquiries?priority=urgent&limit=50", {
        method: "GET",
        staff: owner.id,
      });
      assert.equal(prioritySearch.status, 200);
      assert.ok(
        (prioritySearch.body.items as Array<{ id: string }>).some((i) => i.id === tagged!.id),
      );

      const textSearch = await json(
        `/api/platform/contact/inquiries?search=${encodeURIComponent(`CTX-SV-P${suffix.slice(0, 5).toUpperCase()}`)}`,
        { method: "GET", staff: owner.id },
      );
      assert.equal(textSearch.status, 200);
      assert.equal((textSearch.body.items as Array<{ id: string }>).length, 1);
      assert.equal(textSearch.body.items[0].id, plain!.id);

      await json(`/api/platform/contact/saved-views/${viewId}`, {
        method: "DELETE",
        staff: owner.id,
      });
      const remaining = await db
        .select()
        .from(crmSavedViewsTable)
        .where(eq(crmSavedViewsTable.id, viewId));
      assert.equal(remaining.length, 0);
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });
});
