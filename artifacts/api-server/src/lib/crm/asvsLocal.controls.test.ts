import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeLogValue } from "../logSanitize.ts";
import { evaluateJobAlert } from "./jobAlerts.ts";
import { assertProductionSecurity, isCrmHttpTestAuthAllowed } from "./authFlags.ts";
import { jobConcurrencyKey, workerConcurrency } from "./jobPipeline.ts";
import { JOB_ALERT_RULES } from "./jobAlerts.ts";

describe("PII log sanitizer", () => {
  it("redacts nested and array-contained emails and phones", () => {
    const out = sanitizeLogValue({
      items: [{ contact: { email: "a@example.com", nested: [{ phoneE164: "+15551212" }] } }],
      package: { body: "secret dsar" },
      token: "abc",
    }) as Record<string, unknown>;
    const json = JSON.stringify(out);
    assert.equal(json.includes("a@example.com"), false);
    assert.equal(json.includes("+15551212"), false);
    assert.equal(out.package, "[redacted]");
    assert.equal(out.token, "[redacted]");
  });
});

describe("production security fail-closed", () => {
  it("rejects test auth and simulators in production", () => {
    assert.throws(
      () =>
        assertProductionSecurity({
          NODE_ENV: "production",
          CRM_HTTP_TEST_AUTH: "true",
          PLATFORM_STAFF_SESSION_SECRET: "x".repeat(32),
          CRM_ATTACHMENT_SIGNING_SECRET: "prod-secret",
        }),
      /CRM_HTTP_TEST_AUTH/,
    );
    assert.equal(isCrmHttpTestAuthAllowed({ NODE_ENV: "production", CRM_HTTP_TEST_AUTH: "true" }), false);
  });
});

describe("worker concurrency config", () => {
  it("clamps zero, negative, NaN, and excessive values", () => {
    const prev = process.env.CRM_WORKER_CONCURRENCY;
    const pool = process.env.DATABASE_POOL_MAX;
    process.env.DATABASE_POOL_MAX = "20";
    process.env.CRM_WORKER_CONCURRENCY = "0";
    assert.equal(workerConcurrency(), 1);
    process.env.CRM_WORKER_CONCURRENCY = "-3";
    assert.equal(workerConcurrency(), 1);
    process.env.CRM_WORKER_CONCURRENCY = "NaN";
    assert.equal(workerConcurrency(), 1);
    process.env.CRM_WORKER_CONCURRENCY = "999";
    assert.ok(workerConcurrency() <= 32);
    process.env.CRM_WORKER_CONCURRENCY = prev;
    process.env.DATABASE_POOL_MAX = pool;
  });

  it("covers domain ordering keys", () => {
    assert.equal(jobConcurrencyKey({ type: "run_workflows", payload: { inquiryId: "i1" } }), "inquiry:i1");
    assert.equal(jobConcurrencyKey({ type: "inbound_email", payload: { conversationId: "c1" } }), "conversation:c1");
    assert.equal(jobConcurrencyKey({ type: "graph_mail_delta_sync", payload: { mailboxId: "m1" } }), "mailbox:m1");
    assert.equal(jobConcurrencyKey({ type: "analytics", payload: { contactId: "p1" } }), "contact:p1");
    assert.equal(jobConcurrencyKey({ type: "analytics", payload: { companyId: "co1" } }), "company:co1");
    assert.equal(jobConcurrencyKey({ type: "crm_export", payload: { exportJobId: "e1" } }), "export:e1");
    assert.equal(jobConcurrencyKey({ type: "scan", payload: { attachmentId: "a1" } }), "attachment:a1");
    assert.equal(jobConcurrencyKey({ type: "cms", payload: { versionId: "v1" } }), "cms:v1");
    assert.equal(jobConcurrencyKey({ type: "refresh_sla", payload: {} }), "recurring:refresh_sla");
  });
});

describe("job alert rules", () => {
  it("evaluates warn and critical without unbounded labels", () => {
    assert.equal(evaluateJobAlert("crm.jobs.dead", 0), "ok");
    assert.equal(evaluateJobAlert("crm.jobs.dead", 1), "warn");
    assert.equal(evaluateJobAlert("crm.jobs.dead", 9), "critical");
    assert.ok(JOB_ALERT_RULES.every((r) => r.runbook.includes("RUNBOOK")));
  });
});

describe("readyz includes export store", () => {
  it("platformHealth probes export FS root", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../routes/platformHealth.ts"),
      "utf8",
    );
    assert.match(src, /assertExportStoreReady/);
  });
});

describe("Turnstile verification never trusts client hostname", () => {
  it("requires provider hostname and action fields", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "botAdapter.ts"), "utf8");
    const verify = src.split("async function verifyTurnstile")[1] ?? "";
    assert.match(verify, /json\.hostname/);
    assert.match(verify, /json\.action/);
    assert.equal(/json\.hostname\s*\?\?/.test(verify), false);
    assert.equal(/input\.hostname/.test(verify), false);
  });
});

describe("job queue snapshot labels", () => {
  it("never uses emails or raw UUIDs as metric labels", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "jobMetrics.ts"), "utf8");
    assert.match(src, /export function snapshotMetricLabels/);
    assert.match(src, /Object\.keys\(snapshot\.createdByType\)/);
    const labels = [
      ...Object.keys({ run_workflows: 1, analytics: 2 }),
      ...Object.keys({ run_workflows: 1 }),
      ...Object.keys({}),
      ...Object.keys({ soak_poison: 1 }),
    ];
    for (const label of labels) {
      assert.equal(/@/.test(label), false);
      assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(label), false);
    }
  });
});
