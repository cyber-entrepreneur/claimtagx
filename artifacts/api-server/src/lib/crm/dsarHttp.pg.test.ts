import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("DSAR HTTP tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
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

describe("DSAR HTTP (CRM_HTTP_TEST_AUTH)", () => {
  it("covers access/export/correction/deletion hold, anonymize, and object authorization", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmContactsTable, crmStaffTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);
    const [officer] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.http.${suffix}@example.com`,
        emailNormalized: `dsar.http.${suffix}@example.com`,
        name: "DSAR HTTP Officer",
        role: "admin",
        permissions: ["privacy.dsar", "inquiries.export", "inquiries.delete", "config.manage"],
      })
      .returning();
    const [sales] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.sales.${suffix}@example.com`,
        emailNormalized: `dsar.sales.${suffix}@example.com`,
        name: "DSAR HTTP Sales",
        role: "sales",
        permissions: ["inquiries.view"],
      })
      .returning();
    const [otherExporter] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.other.${suffix}@example.com`,
        emailNormalized: `dsar.other.${suffix}@example.com`,
        name: "DSAR Other Exporter",
        role: "admin",
        permissions: ["inquiries.export", "privacy.dsar"],
      })
      .returning();
    assert.ok(officer && sales && otherExporter);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        email: `dsar.http.sub.${suffix}@example.com`,
        emailNormalized: `dsar.http.sub.${suffix}@example.com`,
        firstName: "Http",
        lastName: "Subject",
        jobTitle: "Buyer",
        country: "US",
      })
      .returning();
    assert.ok(contact);

    const { server, base } = await listenApp();
    const json = async (path: string, init: RequestInit & { staff?: string }) => {
      const headers = new Headers(init.headers);
      headers.set("content-type", "application/json");
      if (init.staff) headers.set("x-crm-test-staff-id", init.staff);
      const res = await fetch(`${base}${path}`, { ...init, headers });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    };

    async function advance(id: string) {
      for (const step of [
        { status: "identity_pending" },
        { status: "identity_verified", identityVerified: true },
        { status: "in_progress" },
      ] as const) {
        const tr = await json(`/api/platform/contact/dsar/${id}/transition`, {
          method: "POST",
          staff: officer.id,
          body: JSON.stringify(step),
        });
        assert.equal(tr.status, 200, JSON.stringify(tr.body));
      }
    }

    try {
      const denied = await json("/api/platform/contact/dsar", {
        method: "POST",
        staff: sales.id,
        body: JSON.stringify({ contactId: contact.id, requestType: "access" }),
      });
      assert.equal(denied.status, 403);

      const access = await json("/api/platform/contact/dsar", {
        method: "POST",
        staff: officer.id,
        body: JSON.stringify({ contactId: contact.id, requestType: "access" }),
      });
      assert.equal(access.status, 201, JSON.stringify(access.body));
      await advance(access.body.id);
      const packaged = await json(`/api/platform/contact/dsar/${access.body.id}/export`, {
        method: "POST",
        staff: officer.id,
      });
      assert.equal(packaged.status, 200, JSON.stringify(packaged.body));

      const correction = await json("/api/platform/contact/dsar", {
        method: "POST",
        staff: officer.id,
        body: JSON.stringify({ contactId: contact.id, requestType: "correction" }),
      });
      assert.equal(correction.status, 201);
      await advance(correction.body.id);
      const corrected = await json(`/api/platform/contact/dsar/${correction.body.id}/correct`, {
        method: "POST",
        staff: officer.id,
        body: JSON.stringify({ firstName: "Corrected" }),
      });
      assert.equal(corrected.status, 200, JSON.stringify(corrected.body));

      const hold = await json("/api/platform/contact/governance/legal-hold", {
        method: "POST",
        staff: officer.id,
        body: JSON.stringify({ contactId: contact.id, reason: "http dsar litigation hold" }),
      });
      assert.equal(hold.status, 201, JSON.stringify(hold.body));

      const deletion = await json("/api/platform/contact/dsar", {
        method: "POST",
        staff: officer.id,
        body: JSON.stringify({ contactId: contact.id, requestType: "deletion" }),
      });
      assert.equal(deletion.status, 201);
      await advance(deletion.body.id);
      const blocked = await json(`/api/platform/contact/dsar/${deletion.body.id}/delete`, {
        method: "POST",
        staff: officer.id,
      });
      assert.equal(blocked.status, 409);

      const released = await json(`/api/platform/contact/governance/legal-hold/${hold.body.id}/release`, {
        method: "POST",
        staff: officer.id,
      });
      assert.equal(released.status, 200, JSON.stringify(released.body));

      const wiped = await json(`/api/platform/contact/dsar/${deletion.body.id}/delete`, {
        method: "POST",
        staff: officer.id,
      });
      assert.equal(wiped.status, 200, JSON.stringify(wiped.body));

      const durable = await json("/api/platform/contact/governance/dsar-export", {
        method: "POST",
        staff: officer.id,
        body: JSON.stringify({ contactId: contact.id }),
      });
      assert.equal(durable.status, 202, JSON.stringify(durable.body));
      const exportId = durable.body.exportId ?? durable.body.job?.id;
      assert.ok(exportId);
      const cross = await json(`/api/platform/contact/dsar-exports/${exportId}`, {
        method: "GET",
        staff: otherExporter.id,
      });
      assert.ok([403, 404].includes(cross.status), JSON.stringify(cross.body));

      const otherContact = await db
        .insert(crmContactsTable)
        .values({
          email: `dsar.http.anon.${suffix}@example.com`,
          emailNormalized: `dsar.http.anon.${suffix}@example.com`,
          firstName: "Anon",
          lastName: "Me",
          jobTitle: "Buyer",
          country: "US",
        })
        .returning();
      const anon = await json("/api/platform/contact/governance/anonymize", {
        method: "POST",
        staff: officer.id,
        body: JSON.stringify({ contactId: otherContact[0]!.id, reason: "http anonymize after dsar" }),
      });
      assert.equal(anon.status, 200, JSON.stringify(anon.body));
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });
});
