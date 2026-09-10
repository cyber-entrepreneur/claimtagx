import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { assertIsolatedCrmDatabase } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  assertIsolatedCrmDatabase("handler lease tests");
}

async function steal(jobId: string) {
  const { db, crmJobsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(crmJobsTable)
    .set({ lockedBy: "thief", claimGeneration: 99_999 })
    .where(eq(crmJobsTable.id, jobId));
}

async function claimSpecificJobById(workerId: string, jobId: string) {
  const { db, crmJobsTable } = await import("@workspace/db");
  const { eq, sql } = await import("drizzle-orm");
  const [updated] = await db
    .update(crmJobsTable)
    .set({
      status: "running",
      lockedBy: workerId,
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
      attempts: sql`${crmJobsTable.attempts} + 1`,
    })
    .where(eq(crmJobsTable.id, jobId))
    .returning();
  if (!updated) throw new Error("failed to claim test job by id");
  return {
    id: updated.id,
    type: updated.type,
    payload: updated.payload as Record<string, unknown>,
    correlationId: updated.correlationId,
    claimGeneration: updated.claimGeneration,
    attempts: updated.attempts,
    maxAttempts: updated.maxAttempts,
  };
}

async function claimSpecificJob(workerId: string, idempotencyKey: string) {
  const { db, crmJobsTable } = await import("@workspace/db");
  const { eq, sql } = await import("drizzle-orm");
  const [job] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.idempotencyKey, idempotencyKey)).limit(1);
  if (!job) throw new Error(`job ${idempotencyKey} not enqueued`);
  const [updated] = await db
    .update(crmJobsTable)
    .set({
      status: "running",
      lockedBy: workerId,
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
      attempts: sql`${crmJobsTable.attempts} + 1`,
    })
    .where(eq(crmJobsTable.id, job.id))
    .returning();
  if (!updated) throw new Error("failed to claim test job");
  return {
    id: updated.id,
    type: updated.type,
    payload: updated.payload as Record<string, unknown>,
    correlationId: updated.correlationId,
    claimGeneration: updated.claimGeneration,
    attempts: updated.attempts,
    maxAttempts: updated.maxAttempts,
  };
}

async function runStolen(type: string, payload: Record<string, unknown>) {
  process.env.CRM_ALLOW_TEST_JOBS = "true";
  process.env.CRM_TEST_SIDE_EFFECT_DELAY_MS = "200";
  process.env.CRM_JOB_HEARTBEAT_MS = "40";
  const jobs = await import("./jobs.ts");
  const { db, crmJobsTable } = await import("@workspace/db");
  const idempotencyKey = `lease-${type}-${randomUUID()}`;
  const [inserted] = await db
    .insert(crmJobsTable)
    .values({ type, payload, status: "pending", runAt: new Date(), idempotencyKey })
    .returning();
  assert.ok(inserted);
  const job = await claimSpecificJob("lease-owner", idempotencyKey);
  assert.ok(job, "expected targeted lease job claim");
  const running = executeWithSteal(job);
  await new Promise((r) => setTimeout(r, 60));
  await steal(job.id);
  await running;
  return { jobId: job.id };
}

async function executeWithSteal(job: {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  claimGeneration: number;
  attempts: number;
  maxAttempts: number;
}) {
  const jobs = await import("./jobs.ts");
  await jobs.executeClaimedCrmJob(job, "lease-owner");
}

describe("production handlers abort side effects after lease loss", () => {
  it("does not insert analytics after ownership is stolen", async () => {
    requireIsolatedDb();
    const event = `an_${randomUUID().slice(0, 8)}`;
    const { db, crmAnalyticsEventsTable, crmJobEffectsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const before = (await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event))).length;
    await runStolen("analytics", { event });
    const after = (await db.select().from(crmAnalyticsEventsTable).where(eq(crmAnalyticsEventsTable.event, event))).length;
    assert.equal(after, before);
    const effects = await db.select().from(crmJobEffectsTable).where(eq(crmJobEffectsTable.kind, "analytics"));
    void effects;
  });

  it("does not create a notification after ownership is stolen", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmStaffTable, crmNotificationsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [staff] = await db.select().from(crmStaffTable).limit(1);
    assert.ok(staff);
    const title = `n_${randomUUID().slice(0, 8)}`;
    const before = (await db.select().from(crmNotificationsTable).where(eq(crmNotificationsTable.title, title))).length;
    await runStolen("notify_staff", { staffId: staff.id, type: "notice", title, inquiryId: randomUUID() });
    const after = (await db.select().from(crmNotificationsTable).where(eq(crmNotificationsTable.title, title))).length;
    assert.equal(after, before);
  });

  it("does not send acknowledgment email after ownership is stolen", async () => {
    requireIsolatedDb();
    const inquiryId = randomUUID();
    const { db, crmMessagesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const before = (await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.inquiryId, inquiryId))).length;
    await runStolen("send_acknowledgment", { inquiryId, templateKey: "ack" });
    const after = (await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.inquiryId, inquiryId))).length;
    assert.equal(after, before);
  });

  it("does not apply workflow actions after ownership is stolen", async () => {
    requireIsolatedDb();
    const { db, crmWorkflowExecutionsTable } = await import("@workspace/db");
    const before = (await db.select({ id: crmWorkflowExecutionsTable.id }).from(crmWorkflowExecutionsTable)).length;
    await runStolen("run_workflows", { trigger: "inquiry.created", inquiryId: randomUUID() });
    const after = (await db.select({ id: crmWorkflowExecutionsTable.id }).from(crmWorkflowExecutionsTable)).length;
    assert.equal(after, before);
  });

  it("does not refresh SLA rows after ownership is stolen", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const queue = await import("./queue.ts");
    const jobs = await import("./jobs.ts");
    const {
      db,
      crmJobsTable,
      crmSlaInstancesTable,
      crmSlaPoliciesTable,
      crmContactsTable,
      crmInquiriesTable,
    } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        email: `lease.sla.${suffix}@example.com`,
        emailNormalized: `lease.sla.${suffix}@example.com`,
        firstName: "Lease",
        lastName: "Sla",
        jobTitle: "Ops",
        country: "US",
      })
      .returning();
    assert.ok(contact);
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-LEASE-SLA-${suffix}`,
        contactId: contact.id,
        inquiryType: "general",
        status: "NEW",
        channel: "web_form",
      })
      .returning();
    assert.ok(inquiry);
    const [policy] = await db.select().from(crmSlaPoliciesTable).limit(1);
    assert.ok(policy);
    const [owned] = await db
      .insert(crmSlaInstancesTable)
      .values({
        inquiryId: inquiry.id,
        policyId: policy.id,
        policyVersion: policy.version,
        measure: `lease_${suffix}`,
        dueAt: new Date(Date.now() - 60_000),
        status: "ON_TRACK",
      })
      .returning();
    assert.ok(owned);
    await db
      .update(crmJobsTable)
      .set({ status: "completed", completedAt: new Date(), lockedBy: null, leaseExpiresAt: null })
      .where(eq(crmJobsTable.type, "refresh_sla"));
    await queue.scheduleRecurringSlaRefresh();
    const [pending] = await db
      .select()
      .from(crmJobsTable)
      .where(and(eq(crmJobsTable.type, "refresh_sla"), eq(crmJobsTable.status, "pending")))
      .limit(1);
    assert.ok(pending);
    const targeted = await db.execute(
      (await import("drizzle-orm")).sql`
        UPDATE crm_jobs AS j
        SET
          status = 'running',
          attempts = j.attempts + 1,
          locked_at = NOW(),
          locked_by = 'lease-sla',
          lease_expires_at = NOW() + interval '5 minutes',
          claim_generation = j.claim_generation + 1,
          run_at = NOW()
        WHERE j.id = ${pending.id}
        RETURNING j.*
      `,
    );
    const rows = (targeted as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    assert.ok(rows[0], "targeted SLA claim");
    const job = {
      id: String(rows[0].id),
      type: "refresh_sla",
      payload: (rows[0].payload ?? {}) as Record<string, unknown>,
      correlationId: rows[0].correlation_id == null ? null : String(rows[0].correlation_id),
      claimGeneration: Number(rows[0].claim_generation),
      attempts: Number(rows[0].attempts ?? 1),
      maxAttempts: Number(rows[0].max_attempts ?? 8),
    };
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_TEST_SIDE_EFFECT_DELAY_MS = "200";
    process.env.CRM_JOB_HEARTBEAT_MS = "40";
    const running = jobs.executeClaimedCrmJob(job, "lease-sla");
    await new Promise((r) => setTimeout(r, 60));
    await steal(job.id);
    await running;
    const [after] = await db.select().from(crmSlaInstancesTable).where(eq(crmSlaInstancesTable.id, owned.id)).limit(1);
    assert.equal(after?.status, "ON_TRACK");
  });

  it("does not run retention updates after ownership is stolen", async () => {
    requireIsolatedDb();
    const queue = await import("./queue.ts");
    const jobs = await import("./jobs.ts");
    const { db, crmJobsTable, crmMessagesTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_TEST_SIDE_EFFECT_DELAY_MS = "200";
    process.env.CRM_JOB_HEARTBEAT_MS = "40";
    await db
      .update(crmJobsTable)
      .set({ status: "completed", completedAt: new Date(), lockedBy: null, leaseExpiresAt: null })
      .where(eq(crmJobsTable.type, "enforce_retention"));
    await queue.scheduleRecurringRetention();
    const [pending] = await db
      .select()
      .from(crmJobsTable)
      .where(and(eq(crmJobsTable.type, "enforce_retention"), eq(crmJobsTable.status, "pending")))
      .limit(1);
    assert.ok(pending, "expected a pending enforce_retention job");
    const targeted = await db.execute(
      (await import("drizzle-orm")).sql`
        UPDATE crm_jobs AS j
        SET
          status = 'running',
          attempts = j.attempts + 1,
          locked_at = NOW(),
          locked_by = 'lease-owner',
          lease_expires_at = NOW() + interval '5 minutes',
          claim_generation = j.claim_generation + 1,
          run_at = NOW()
        WHERE j.id = ${pending.id}
        RETURNING j.*
      `,
    );
    const rows = (targeted as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    assert.ok(rows[0], "targeted retention claim");
    const job = {
      id: String(rows[0].id),
      type: "enforce_retention",
      payload: (rows[0].payload ?? {}) as Record<string, unknown>,
      correlationId: rows[0].correlation_id == null ? null : String(rows[0].correlation_id),
      claimGeneration: Number(rows[0].claim_generation),
      attempts: Number(rows[0].attempts ?? 1),
      maxAttempts: Number(rows[0].max_attempts ?? 8),
    };
    const redacted = (
      await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.body, "[redacted under retention policy]"))
    ).length;
    const running = jobs.executeClaimedCrmJob(job, "lease-owner");
    await new Promise((r) => setTimeout(r, 60));
    await steal(job.id);
    await running;
    const after = (
      await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.body, "[redacted under retention policy]"))
    ).length;
    assert.equal(after, redacted);
  });
});
