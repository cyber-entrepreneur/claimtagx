import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("record lock HTTP tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

async function listenApp(): Promise<{ server: Server; base: string }> {
  process.env.CRM_HTTP_TEST_AUTH = "true";
  process.env.CRM_EMAIL_SIMULATOR = "true";
  process.env.NODE_ENV = "development";
  const { default: app } = await import("../../app.ts");
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

async function makeStaff(name: string, permissions: string[] = []) {
  const { db, crmStaffTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [staff] = await db
    .insert(crmStaffTable)
    .values({
      email: `${name}.${suffix}@example.com`,
      emailNormalized: `${name}.${suffix}@example.com`,
      name,
      role: permissions.length ? "sales" : "admin",
      permissions,
    })
    .returning();
  assert.ok(staff);
  return staff!;
}

async function makeInquiry(assignedStaffId: string) {
  const { db, crmContactsTable, crmInquiriesTable, crmConversationsTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [contact] = await db
    .insert(crmContactsTable)
    .values({
      firstName: "Lock",
      lastName: "HTTP",
      jobTitle: "Buyer",
      email: `lock.http.${suffix}@example.com`,
      emailNormalized: `lock.http.${suffix}@example.com`,
      country: "US",
    })
    .returning();
  const [inquiry] = await db
    .insert(crmInquiriesTable)
    .values({
      reference: `CTX-2099-H${suffix.slice(0, 5).toUpperCase()}`,
      contactId: contact!.id,
      inquiryType: "sales",
      assignedStaffId,
      status: "ASSIGNED",
      channel: "web",
    })
    .returning();
  await db.insert(crmConversationsTable).values({ inquiryId: inquiry!.id });
  assert.ok(inquiry);
  return inquiry!;
}

describe("record lock + presence HTTP (CRM_HTTP_TEST_AUTH)", () => {
  it("covers acquire conflict, heartbeat, override permission, presence, and concurrent save CAS", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const a = await makeStaff("lock-http-a");
    const editorB = await makeStaff("lock-http-editor-b");
    const { db, crmStaffTable } = await import("@workspace/db");
    const suffixR = randomUUID().slice(0, 8);
    const [randoRow] = await db
      .insert(crmStaffTable)
      .values({
        email: `lock-http-r.${suffixR}@example.com`,
        emailNormalized: `lock-http-r.${suffixR}@example.com`,
        name: "lock-http-rando",
        role: "sales",
        permissions: ["inquiries.view"],
      })
      .returning();
    assert.ok(randoRow);
    const rando = randoRow!;
    const manager = await makeStaff("lock-http-mgr", ["inquiries.assign", "inquiries.view"]);
    const inquiry = await makeInquiry(a.id);

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
      const entity = { entityType: "inquiry", entityId: inquiry.id, intent: "edit" };

      const lockA = await json("/api/platform/contact/locks/acquire", {
        method: "POST",
        staff: a.id,
        body: JSON.stringify(entity),
      });
      assert.equal(lockA.status, 201);
      const lockId = lockA.body.lock?.id as string;
      assert.ok(lockId);

      const lockB = await json("/api/platform/contact/locks/acquire", {
        method: "POST",
        staff: editorB.id,
        body: JSON.stringify(entity),
      });
      assert.equal(lockB.status, 409);
      assert.equal(lockB.body.code, "RECORD_LOCKED");

      const heartbeat = await json(`/api/platform/contact/locks/${lockId}/heartbeat`, {
        method: "POST",
        staff: a.id,
      });
      assert.equal(heartbeat.status, 200);

      const wrongHeartbeat = await json(`/api/platform/contact/locks/${lockId}/heartbeat`, {
        method: "POST",
        staff: editorB.id,
      });
      assert.equal(wrongHeartbeat.status, 409);

      await json("/api/platform/contact/presence/heartbeat", {
        method: "POST",
        staff: editorB.id,
        body: JSON.stringify({ ...entity, intent: "view" }),
      });
      const presence = await json(
        `/api/platform/contact/presence?entityType=inquiry&entityId=${inquiry.id}`,
        { method: "GET", staff: a.id },
      );
      assert.equal(presence.status, 200);
      assert.equal(presence.body.lock?.staffId, a.id);
      assert.ok(Array.isArray(presence.body.viewers));

      const overrideDenied = await json(`/api/platform/contact/locks/${lockId}/override`, {
        method: "POST",
        staff: rando.id,
        body: JSON.stringify({ reason: "need access" }),
      });
      assert.equal(overrideDenied.status, 403);

      const overrideOk = await json(`/api/platform/contact/locks/${lockId}/override`, {
        method: "POST",
        staff: manager.id,
        body: JSON.stringify({ reason: "SLA breach — manager takeover" }),
      });
      assert.equal(overrideOk.status, 200);

      const detail = await json(`/api/platform/contact/inquiries/${inquiry.id}`, {
        method: "GET",
        staff: a.id,
      });
      assert.equal(detail.status, 200);
      const updatedAt = detail.body.inquiry?.updatedAt as string;

      const replyOk = await json(`/api/platform/contact/inquiries/${inquiry.id}/reply`, {
        method: "POST",
        staff: a.id,
        body: JSON.stringify({ body: "First reply", expectedUpdatedAt: updatedAt }),
      });
      assert.equal(replyOk.status, 201);

      const stale = await json(`/api/platform/contact/inquiries/${inquiry.id}/reply`, {
        method: "POST",
        staff: editorB.id,
        body: JSON.stringify({ body: "Stale reply", expectedUpdatedAt: updatedAt }),
      });
      assert.equal(stale.status, 409);

      await json(`/api/platform/contact/locks/${lockId}/release`, {
        method: "POST",
        staff: manager.id,
      });
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });
});
