import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("record lock tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
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
      role: "sales",
      permissions,
    })
    .returning();
  assert.ok(staff);
  return staff!;
}

async function makeInquiry() {
  const { db, crmContactsTable, crmInquiriesTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const [contact] = await db
    .insert(crmContactsTable)
    .values({
      firstName: "Lock",
      lastName: "Target",
      jobTitle: "Buyer",
      email: `lock.${suffix}@example.com`,
      emailNormalized: `lock.${suffix}@example.com`,
      country: "US",
    })
    .returning();
  const [inquiry] = await db
    .insert(crmInquiriesTable)
    .values({
      reference: `CTX-2099-L${suffix.slice(0, 5).toUpperCase()}`,
      contactId: contact!.id,
      inquiryType: "sales",
    })
    .returning();
  assert.ok(inquiry);
  return inquiry!;
}

describe("record presence + locking (PostgreSQL)", () => {
  it("two editors: second acquire is rejected with holder info while lease is active", async () => {
    requireIsolatedDb();
    const { acquireLock, RecordLockConflictError } = await import("./recordLock.ts");
    const a = await makeStaff("lock-a");
    const b = await makeStaff("lock-b");
    const inquiry = await makeInquiry();

    const lockA = await acquireLock({
      entityType: "inquiry",
      entityId: inquiry.id,
      staffId: a.id,
      ttlMs: 5_000,
    });
    assert.equal(lockA.staffId, a.id);
    assert.equal(lockA.lockGeneration, 1);

    await assert.rejects(
      () => acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: b.id, ttlMs: 5_000 }),
      (err: unknown) => {
        assert.ok(err instanceof RecordLockConflictError);
        assert.equal(err.status, 409);
        assert.equal(err.holder?.staffId, a.id);
        return true;
      },
    );
  });

  it("same staff re-acquiring renews (does not conflict with itself)", async () => {
    requireIsolatedDb();
    const { acquireLock } = await import("./recordLock.ts");
    const a = await makeStaff("lock-renew");
    const inquiry = await makeInquiry();
    const first = await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: a.id, ttlMs: 5_000 });
    const second = await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: a.id, ttlMs: 5_000 });
    assert.equal(second.id, first.id);
    assert.equal(second.lockGeneration, first.lockGeneration + 1);
  });

  it("stale lock: expired lease can be stolen by another editor", async () => {
    requireIsolatedDb();
    const { acquireLock } = await import("./recordLock.ts");
    const a = await makeStaff("lock-stale-a");
    const b = await makeStaff("lock-stale-b");
    const inquiry = await makeInquiry();
    await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: a.id, ttlMs: 10 });
    await new Promise((r) => setTimeout(r, 60));
    const stolen = await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: b.id, ttlMs: 5_000 });
    assert.equal(stolen.staffId, b.id);
    assert.ok(stolen.leaseExpiresAt.getTime() > Date.now());
  });

  it("lease renewal: heartbeat extends the lease and rejects heartbeats from a lock you don't own", async () => {
    requireIsolatedDb();
    const { acquireLock, heartbeatLock } = await import("./recordLock.ts");
    const a = await makeStaff("lock-heartbeat-a");
    const b = await makeStaff("lock-heartbeat-b");
    const inquiry = await makeInquiry();
    const lock = await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: a.id, ttlMs: 200 });
    const renewed = await heartbeatLock({ lockId: lock.id, staffId: a.id, ttlMs: 30_000 });
    assert.ok(renewed.leaseExpiresAt.getTime() > lock.leaseExpiresAt.getTime());

    await assert.rejects(
      () => heartbeatLock({ lockId: lock.id, staffId: b.id }),
      (err: Error & { status?: number }) => err.status === 409,
    );
  });

  it("disconnect / expiry cleanup removes stale presence and long-expired locks", async () => {
    requireIsolatedDb();
    const { acquireLock, heartbeatPresence, cleanupExpired } = await import("./recordLock.ts");
    const { db, crmRecordPresenceTable, crmRecordLocksTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const a = await makeStaff("lock-cleanup-a");
    const inquiry = await makeInquiry();
    const lock = await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: a.id, ttlMs: 1 });
    await heartbeatPresence({ entityType: "inquiry", entityId: inquiry.id, staffId: a.id });
    // Force both rows into the past so cleanup treats them as stale without waiting on real time.
    await db
      .update(crmRecordPresenceTable)
      .set({ lastSeenAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(crmRecordPresenceTable.staffId, a.id));
    await db
      .update(crmRecordLocksTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(crmRecordLocksTable.id, lock.id));
    const result = await cleanupExpired({ presenceStaleMs: 60_000, lockGraceMs: 60_000 });
    assert.ok(result.presenceRemoved >= 1);
    assert.ok(result.locksRemoved >= 1);
    const remainingPresence = await db
      .select()
      .from(crmRecordPresenceTable)
      .where(eq(crmRecordPresenceTable.staffId, a.id));
    assert.equal(remainingPresence.length, 0);
    const remainingLock = await db.select().from(crmRecordLocksTable).where(eq(crmRecordLocksTable.id, lock.id));
    assert.equal(remainingLock.length, 0);
  });

  it("override: authorized staff can force-take a lock with an audited reason", async () => {
    requireIsolatedDb();
    const { acquireLock, overrideLock } = await import("./recordLock.ts");
    const { db, crmAuditEventsTable } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const holder = await makeStaff("lock-override-holder");
    const manager = await makeStaff("lock-override-manager", ["config.manage"]);
    const inquiry = await makeInquiry();
    const lock = await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: holder.id, ttlMs: 60_000 });

    const overridden = await overrideLock({
      entityType: "inquiry",
      entityId: inquiry.id,
      staffId: manager.id,
      reason: "Holder is on leave, urgent SLA breach",
      permissions: ["config.manage"],
    });
    assert.equal(overridden.staffId, manager.id);
    assert.equal(overridden.lockGeneration, lock.lockGeneration + 1);

    const audits = await db
      .select()
      .from(crmAuditEventsTable)
      .where(and(eq(crmAuditEventsTable.action, "record_lock.override"), eq(crmAuditEventsTable.entityId, inquiry.id)));
    assert.ok(audits.length >= 1);
    assert.equal(audits[0]!.actorId, manager.id);
  });

  it("unauthorized override: insufficient permission is rejected (403) and short reasons are rejected (400)", async () => {
    requireIsolatedDb();
    const { acquireLock, overrideLock } = await import("./recordLock.ts");
    const holder = await makeStaff("lock-unauth-holder");
    const rando = await makeStaff("lock-unauth-rando", []);
    const manager = await makeStaff("lock-unauth-manager", ["inquiries.assign"]);
    const inquiry = await makeInquiry();
    await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: holder.id, ttlMs: 60_000 });

    await assert.rejects(
      () =>
        overrideLock({
          entityType: "inquiry",
          entityId: inquiry.id,
          staffId: rando.id,
          reason: "trying to take over",
          permissions: [],
        }),
      (err: Error & { status?: number }) => err.status === 403,
    );

    await assert.rejects(
      () =>
        overrideLock({
          entityType: "inquiry",
          entityId: inquiry.id,
          staffId: manager.id,
          reason: "hi",
          permissions: ["inquiries.assign"],
        }),
      (err: Error & { status?: number }) => err.status === 400,
    );
  });

  it("listPresence reports viewers and the active lock holder together", async () => {
    requireIsolatedDb();
    const { acquireLock, heartbeatPresence, listPresence } = await import("./recordLock.ts");
    const holder = await makeStaff("lock-presence-holder");
    const viewer = await makeStaff("lock-presence-viewer");
    const inquiry = await makeInquiry();
    await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: holder.id, ttlMs: 60_000 });
    await heartbeatPresence({ entityType: "inquiry", entityId: inquiry.id, staffId: holder.id, intent: "edit" });
    await heartbeatPresence({ entityType: "inquiry", entityId: inquiry.id, staffId: viewer.id, intent: "view" });

    const snapshot = await listPresence({ entityType: "inquiry", entityId: inquiry.id });
    assert.equal(snapshot.lock?.staffId, holder.id);
    assert.equal(snapshot.lock?.active, true);
    assert.equal(snapshot.viewers.length, 2);
    assert.ok(snapshot.viewers.some((v) => v.staffId === viewer.id));
  });

  it("releaseLock is idempotent and only the holder can release", async () => {
    requireIsolatedDb();
    const { acquireLock, releaseLock } = await import("./recordLock.ts");
    const a = await makeStaff("lock-release-a");
    const b = await makeStaff("lock-release-b");
    const inquiry = await makeInquiry();
    const lock = await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: a.id, ttlMs: 60_000 });

    const wrongOwner = await releaseLock({ lockId: lock.id, staffId: b.id });
    assert.equal(wrongOwner.released, false);

    const released = await releaseLock({ lockId: lock.id, staffId: a.id });
    assert.equal(released.released, true);

    const releasedAgain = await releaseLock({ lockId: lock.id, staffId: a.id });
    assert.equal(releasedAgain.released, false);

    // Released lock no longer blocks a fresh acquire by a different staff member.
    const fresh = await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: b.id, ttlMs: 60_000 });
    assert.equal(fresh.staffId, b.id);
  });

  it("concurrent save conflict recovery: advisory lock does not block writes; optimistic CAS still returns 409 with expectedUpdatedAt", async () => {
    requireIsolatedDb();
    const { acquireLock } = await import("./recordLock.ts");
    const { db, crmInquiriesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const a = await makeStaff("lock-cas-a");
    const b = await makeStaff("lock-cas-b");
    const inquiry = await makeInquiry();

    // Both hold/observe presence, but the authoritative conflict guard is the
    // inquiry's own updatedAt CAS (as used by /inquiries/:id/reply) — advisory
    // locking never blocks the write path itself.
    await acquireLock({ entityType: "inquiry", entityId: inquiry.id, staffId: a.id, ttlMs: 60_000 });

    async function saveWithCas(expectedUpdatedAt: string, priority: string) {
      const [current] = await db.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.id, inquiry.id)).limit(1);
      if (!current) throw Object.assign(new Error("Inquiry not found"), { status: 404 });
      if (current.updatedAt.toISOString() !== expectedUpdatedAt) {
        throw Object.assign(new Error("This inquiry changed since you loaded it. Refresh and try again."), {
          status: 409,
          updatedAt: current.updatedAt.toISOString(),
        });
      }
      const [updated] = await db
        .update(crmInquiriesTable)
        .set({ priority, updatedAt: new Date() })
        .where(eq(crmInquiriesTable.id, inquiry.id))
        .returning();
      return updated!;
    }

    const staleExpectedUpdatedAt = inquiry.updatedAt.toISOString();
    const firstSave = await saveWithCas(staleExpectedUpdatedAt, "high");
    assert.equal(firstSave.priority, "high");

    // Second save (from B) still has the stale expectedUpdatedAt captured before A's write.
    await assert.rejects(
      () => saveWithCas(staleExpectedUpdatedAt, "urgent"),
      (err: Error & { status?: number }) => err.status === 409,
    );

    const [current] = await db.select().from(crmInquiriesTable).where(eq(crmInquiriesTable.id, inquiry.id)).limit(1);
    assert.equal(current!.priority, "high");
    void b;
  });
});
