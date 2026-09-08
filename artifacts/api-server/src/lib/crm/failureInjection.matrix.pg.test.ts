import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, after } from "node:test";
import { pool } from "@workspace/db";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("failure-injection pg tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

function baseSubmission(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Fail",
    lastName: "Inject",
    jobTitle: "Engineer",
    companyName: "FailCo",
    email: `fail.${randomUUID().slice(0, 8)}@example.com`,
    country: "US",
    phoneRaw: "+14155552671",
    inquiryType: "general" as const,
    useCaseKeys: [],
    message: "Synthetic failure-injection probe.",
    answers: {},
    termsAccepted: true,
    termsVersion: "2026-04-20",
    privacyPolicyVersion: "2026-04-20",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function clearSubmitFailEnv() {
  delete process.env.CRM_TEST_SUBMIT_FAIL_AT;
  delete process.env.CRM_TEST_TX_RETRY_FAIL_COUNT;
  delete process.env.CRM_TEST_EXPORT_FAIL_AT;
  delete process.env.CRM_TEST_EFFECT_FAIL_AT;
}

describe("failure-injection matrix — contact submit (PostgreSQL)", () => {
  after(async () => {
    await clearSubmitFailEnv();
  });

  it("before_tx leaves no inquiry; during_tx rolls back; after_commit keeps inquiry; duplicate retry is idempotent", async () => {
    requireIsolatedDb();
    process.env.CRM_SKIP_RUNTIME_SEED = "true";
    process.env.NODE_ENV = "test";
    const { submitInquiry } = await import("./orchestrator.ts");
    const { db, crmInquiriesTable, crmAuditEventsTable } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");

    // before_tx
    const keyBefore = randomUUID();
    process.env.CRM_TEST_SUBMIT_FAIL_AT = "before_tx";
    await assert.rejects(
      () =>
        submitInquiry(baseSubmission({ idempotencyKey: keyBefore }), {
          ip: "127.0.0.1",
          userAgent: "fail-matrix",
          correlationId: `before-${keyBefore}`,
        }),
      /before_tx/,
    );
    const beforeRows = await db
      .select()
      .from(crmInquiriesTable)
      .where(eq(crmInquiriesTable.idempotencyKey, keyBefore));
    assert.equal(beforeRows.length, 0);

    // during_tx — counter may advance but inquiry must not commit
    const keyDuring = randomUUID();
    process.env.CRM_TEST_SUBMIT_FAIL_AT = "during_tx";
    await assert.rejects(
      () =>
        submitInquiry(baseSubmission({ idempotencyKey: keyDuring }), {
          ip: "127.0.0.1",
          userAgent: "fail-matrix",
          correlationId: `during-${keyDuring}`,
        }),
      /during_tx/,
    );
    const duringRows = await db
      .select()
      .from(crmInquiriesTable)
      .where(eq(crmInquiriesTable.idempotencyKey, keyDuring));
    assert.equal(duringRows.length, 0);

    // after_commit — inquiry authoritative; client error; retry returns same
    const keyAfter = randomUUID();
    process.env.CRM_TEST_SUBMIT_FAIL_AT = "after_commit";
    await assert.rejects(
      () =>
        submitInquiry(baseSubmission({ idempotencyKey: keyAfter, email: `after.${keyAfter.slice(0, 8)}@example.com` }), {
          ip: "127.0.0.1",
          userAgent: "fail-matrix",
          correlationId: `after-${keyAfter}`,
        }),
      /after_commit/,
    );
    const afterRows = await db
      .select()
      .from(crmInquiriesTable)
      .where(eq(crmInquiriesTable.idempotencyKey, keyAfter));
    assert.equal(afterRows.length, 1);
    const audits = await db
      .select()
      .from(crmAuditEventsTable)
      .where(and(eq(crmAuditEventsTable.entityId, afterRows[0]!.id), eq(crmAuditEventsTable.action, "inquiry.created")));
    assert.ok(audits.length >= 1);

    delete process.env.CRM_TEST_SUBMIT_FAIL_AT;
    const replay = await submitInquiry(
      baseSubmission({
        idempotencyKey: keyAfter,
        email: `after.${keyAfter.slice(0, 8)}@example.com`,
      }),
      { ip: "127.0.0.1", userAgent: "fail-matrix", correlationId: `replay-${keyAfter}` },
    );
    assert.equal(replay.inquiryId, afterRows[0]!.id);
    assert.equal(replay.reference, afterRows[0]!.reference);
    const afterReplay = await db
      .select()
      .from(crmInquiriesTable)
      .where(eq(crmInquiriesTable.idempotencyKey, keyAfter));
    assert.equal(afterReplay.length, 1);
  });

  it("db_timeout / pool_exhaust / rate_limit_tx / serialization retry", async () => {
    requireIsolatedDb();
    process.env.CRM_SKIP_RUNTIME_SEED = "true";
    process.env.NODE_ENV = "test";
    const { submitInquiry } = await import("./orchestrator.ts");
    const { rateLimitOk } = await import("./rateLimit.ts");

    process.env.CRM_TEST_SUBMIT_FAIL_AT = "db_timeout";
    await assert.rejects(
      () =>
        submitInquiry(baseSubmission(), {
          ip: "127.0.0.1",
          userAgent: "fail-matrix",
          correlationId: randomUUID(),
        }),
      /statement timeout/,
    );

    process.env.CRM_TEST_SUBMIT_FAIL_AT = "pool_exhaust";
    await assert.rejects(
      () =>
        submitInquiry(baseSubmission(), {
          ip: "127.0.0.1",
          userAgent: "fail-matrix",
          correlationId: randomUUID(),
        }),
      /pool|connect/i,
    );

    process.env.CRM_TEST_SUBMIT_FAIL_AT = "rate_limit_tx";
    await assert.rejects(() => rateLimitOk(`fail-rl-${randomUUID()}`, 10, 60_000), /rate-limit/);

    delete process.env.CRM_TEST_SUBMIT_FAIL_AT;
    const { armTxRetryFailures } = await import("./txRetry.ts");
    armTxRetryFailures(2);
    const ok = await submitInquiry(baseSubmission({ email: `ser.${randomUUID().slice(0, 8)}@example.com` }), {
      ip: "127.0.0.1",
      userAgent: "fail-matrix",
      correlationId: randomUUID(),
    });
    assert.ok(ok.reference.startsWith("CTX-"));
  });

  it("reference-counter contention under concurrent submits remains unique", async () => {
    requireIsolatedDb();
    process.env.CRM_SKIP_RUNTIME_SEED = "true";
    delete process.env.CRM_TEST_SUBMIT_FAIL_AT;
    const { submitInquiry } = await import("./orchestrator.ts");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        submitInquiry(
          baseSubmission({
            email: `contend.${i}.${randomUUID().slice(0, 6)}@example.com`,
            idempotencyKey: randomUUID(),
          }),
          { ip: "127.0.0.1", userAgent: "fail-matrix", correlationId: `contend-${i}` },
        ),
      ),
    );
    const refs = results.map((r) => r.reference);
    assert.equal(new Set(refs).size, refs.length);
  });
});

describe("failure-injection matrix — workers / effects / exports (PostgreSQL)", () => {
  after(async () => {
    await clearSubmitFailEnv();
  });

  it("poison job dead-letters; replay requeues; lease expiry + stale generation refuse complete", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    const queue = await import("./queue.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq, and, sql } = await import("drizzle-orm");

    const poisonType = `poison_${randomUUID().slice(0, 8)}`;
    const [poison] = await db
      .insert(crmJobsTable)
      .values({
        type: poisonType,
        payload: {},
        status: "pending",
        runAt: new Date(0),
        maxAttempts: 1,
      })
      .returning();
    // Claim this specific row (avoid competing with leftover sleep/test backlog).
    const [claimedPoison] = await db
      .update(crmJobsTable)
      .set({
        status: "running",
        lockedBy: `poison-w-${poisonType}`,
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
        attempts: sql`${crmJobsTable.attempts} + 1`,
      })
      .where(eq(crmJobsTable.id, poison!.id))
      .returning();
    const deadResult = await queue.failJob({
      jobId: claimedPoison!.id,
      workerId: `poison-w-${poisonType}`,
      claimGeneration: claimedPoison!.claimGeneration,
      attempts: claimedPoison!.attempts,
      maxAttempts: claimedPoison!.maxAttempts,
      error: `unknown crm job type: ${poisonType}`,
    });
    assert.equal(deadResult, "dead");
    const [dead] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.id, poison!.id)).limit(1);
    assert.equal(dead?.status, "dead");
    assert.match(dead?.lastError ?? "", /unknown crm job type/);

    // Replay path: enqueue analytics, expire lease, reclaim, stale complete rejected.
    const key = `replay-${randomUUID()}`;
    await queue.enqueueJob("analytics", { event: "fail_matrix_replay" }, { idempotencyKey: key });
    const [row] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.idempotencyKey, key)).limit(1);
    assert.ok(row);
    const [firstClaim] = await db
      .update(crmJobsTable)
      .set({
        status: "running",
        lockedBy: "replay-w",
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() - 1000),
        claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
        attempts: sql`${crmJobsTable.attempts} + 1`,
      })
      .where(eq(crmJobsTable.id, row.id))
      .returning();
    // Reclaim this specific expired lease (avoid SKIP LOCKED backlog from other tests).
    const [again] = await db
      .update(crmJobsTable)
      .set({
        status: "running",
        lockedBy: "replay-w2",
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
        attempts: sql`${crmJobsTable.attempts} + 1`,
      })
      .where(
        sql`${crmJobsTable.id} = ${row.id} AND ${crmJobsTable.status} = 'running' AND ${crmJobsTable.leaseExpiresAt} < NOW()`,
      )
      .returning();
    assert.ok(again);
    assert.ok(again.claimGeneration > firstClaim!.claimGeneration);
    const stale = await queue.completeJob({
      jobId: firstClaim!.id,
      workerId: "replay-w",
      claimGeneration: firstClaim!.claimGeneration,
    });
    assert.equal(stale, false);
    const owned = await queue.completeJob({
      jobId: again.id,
      workerId: "replay-w2",
      claimGeneration: again.claimGeneration,
    });
    assert.equal(owned, true);
  });

  it("export storage failure, partial file, cancel, retry, expired download, cleanup failure", async () => {
    requireIsolatedDb();
    const root = await mkdtemp(join(tmpdir(), "crm-export-fail-"));
    process.env.CRM_EXPORT_FS_ROOT = root;
    process.env.NODE_ENV = "test";
    try {
      const { enqueueExport, processExportJob, cancelExport, getDownload, cleanupExpiredExports } = await import(
        "./exportJobs.ts"
      );
      const { db, crmStaffTable, crmContactsTable, crmInquiriesTable, crmExportJobsTable, crmAuditEventsTable } =
        await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      const suffix = randomUUID().slice(0, 8);
      const [staff] = await db
        .insert(crmStaffTable)
        .values({
          email: `exp.fail.${suffix}@example.com`,
          emailNormalized: `exp.fail.${suffix}@example.com`,
          name: "Export Fail",
          role: "admin",
          permissions: ["inquiries.export", "inquiries.view"],
        })
        .returning();
      const [contact] = await db
        .insert(crmContactsTable)
        .values({
          firstName: "E",
          lastName: "X",
          jobTitle: "B",
          email: `exp.c.${suffix}@example.com`,
          emailNormalized: `exp.c.${suffix}@example.com`,
          country: "US",
        })
        .returning();
      await db.insert(crmInquiriesTable).values({
        reference: `CTX-2099-F${suffix.slice(0, 5).toUpperCase()}`,
        contactId: contact!.id,
        inquiryType: "sales",
        status: "NEW",
      });

      process.env.CRM_TEST_EXPORT_FAIL_AT = "before_write";
      const job1 = await enqueueExport({
        staffId: staff!.id,
        filters: { inquiryType: "sales" },
        columns: ["reference", "status"],
      });
      await assert.rejects(() => processExportJob(job1.id), /storage failure/);
      const [failed] = await db.select().from(crmExportJobsTable).where(eq(crmExportJobsTable.id, job1.id)).limit(1);
      assert.equal(failed?.status, "failed");
      assert.ok(failed?.error);

      delete process.env.CRM_TEST_EXPORT_FAIL_AT;
      const retried = await processExportJob(job1.id);
      assert.equal(retried.status, "completed");

      process.env.CRM_TEST_EXPORT_FAIL_AT = "partial_file";
      const job2 = await enqueueExport({
        staffId: staff!.id,
        filters: { inquiryType: "sales" },
        columns: ["reference"],
      });
      await assert.rejects(() => processExportJob(job2.id), /partial file/);
      const [partial] = await db.select().from(crmExportJobsTable).where(eq(crmExportJobsTable.id, job2.id)).limit(1);
      assert.equal(partial?.status, "failed");
      if (partial?.artifactPath) {
        const bytes = await readFile(join(root, partial.artifactPath), "utf8").catch(() => "");
        assert.ok(bytes.length < 200);
      }

      delete process.env.CRM_TEST_EXPORT_FAIL_AT;
      const job3 = await enqueueExport({
        staffId: staff!.id,
        filters: { inquiryType: "sales" },
        columns: ["reference"],
      });
      const cancelled = await cancelExport({ exportJobId: job3.id, staffId: staff!.id });
      assert.equal(cancelled.status, "cancelled");
      const afterCancel = await processExportJob(job3.id);
      assert.equal(afterCancel.status, "cancelled");

      const done = await enqueueExport({
        staffId: staff!.id,
        filters: { inquiryType: "sales" },
        columns: ["reference"],
      });
      await processExportJob(done.id);
      await db
        .update(crmExportJobsTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(crmExportJobsTable.id, done.id));
      await assert.rejects(() => getDownload({ exportJobId: done.id, staffId: staff!.id }), /expired/i);

      process.env.CRM_TEST_EXPORT_FAIL_AT = "cleanup";
      const cleanup = await cleanupExpiredExports();
      assert.ok(cleanup.errors >= 1);
      const cleanupAudits = await db
        .select()
        .from(crmAuditEventsTable)
        .where(eq(crmAuditEventsTable.action, "export.cleanup_failed"));
      assert.ok(cleanupAudits.length >= 1);
      delete process.env.CRM_TEST_EXPORT_FAIL_AT;
      const cleaned = await cleanupExpiredExports();
      assert.ok(cleaned.removed >= 1);
    } finally {
      delete process.env.CRM_TEST_EXPORT_FAIL_AT;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("effect termination after provider acceptance reconciles without duplicate side effect", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_EMAIL_SIMULATOR = "true";
    process.env.CRM_TEST_EFFECT_FAIL_AT = "after_provider";
    const sim = await import("./emailSimulator.ts");
    sim.resetEmailSimulator();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmContactsTable, crmInquiriesTable, crmConversationsTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        firstName: "Eff",
        lastName: "Fail",
        jobTitle: "Buyer",
        email: `eff.${suffix}@example.com`,
        emailNormalized: `eff.${suffix}@example.com`,
        country: "US",
      })
      .returning();
    const [inquiry] = await db
      .insert(crmInquiriesTable)
      .values({
        reference: `CTX-2026-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
        contactId: contact!.id,
        inquiryType: "sales",
      })
      .returning();
    await db.insert(crmConversationsTable).values({ inquiryId: inquiry!.id, channel: "email" });
    const { enqueueJob } = await import("./queue.ts");
    const { sendInquiryEmail } = await import("./jobs.ts");
    const { emailEffectKey, loadEffect, reconcileUncertainEmail } = await import("./effects.ts");
    const { eq } = await import("drizzle-orm");
    const { crmJobsTable } = await import("@workspace/db");
    const logical = randomUUID();
    await enqueueJob("send_fail_matrix", { inquiryId: inquiry!.id }, { idempotencyKey: `fm-${logical}` });
    const [job] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.idempotencyKey, `fm-${logical}`)).limit(1);
    const [claimed] = await db
      .update(crmJobsTable)
      .set({
        status: "running",
        lockedBy: "fm-w",
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 120_000),
        claimGeneration: 1,
        attempts: 1,
      })
      .where(eq(crmJobsTable.id, job!.id))
      .returning();
    await assert.rejects(
      () =>
        sendInquiryEmail(
          inquiry!.id,
          "STANDARD_ACKNOWLEDGMENT",
          { logicalIntentId: logical },
          {
            jobId: claimed!.id,
            workerId: "fm-w",
            claimGeneration: claimed!.claimGeneration,
            signal: new AbortController().signal,
          },
        ),
      /after provider/,
    );
    delete process.env.CRM_TEST_EFFECT_FAIL_AT;
    const key = emailEffectKey({
      inquiryId: inquiry!.id,
      templateKey: "STANDARD_ACKNOWLEDGMENT",
      intent: "template",
      logicalIntentId: logical,
    });
    assert.equal((await loadEffect(key))?.status, "uncertain");
    assert.equal(await reconcileUncertainEmail(key), "accepted");
    assert.equal(sim.simulatedSendCount(key), 1);
  });
});

process.on("beforeExit", async () => {
  await pool.end().catch(() => undefined);
});
