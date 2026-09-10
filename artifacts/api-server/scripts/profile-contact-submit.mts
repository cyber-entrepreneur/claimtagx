/**
 * Profile Contact submitInquiry stage timings against isolated PG.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const credPath = resolve(root, "tmp/claimtagx-crm-verify/credentials.env");
for (const line of readFileSync(credPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.CRM_SUBMIT_TIMING = "1";
process.env.CRM_SKIP_RUNTIME_SEED = process.env.CRM_SKIP_RUNTIME_SEED ?? "true";

const { pool } = await import("@workspace/db");
const { submitInquiry } = await import("../src/lib/crm/orchestrator.ts");

async function runOnce(i: number) {
  const correlationId = `profile-${i}-${randomUUID()}`;
  const t0 = performance.now();
  const result = await submitInquiry(
    {
      firstName: "Prof",
      lastName: `User${i}`,
      jobTitle: "Engineer",
      companyName: "LoadCo",
      email: `prof.stage.${i}.${Date.now()}@example.com`,
      country: "US",
      phoneRaw: "+14155552671",
      inquiryType: "general",
      useCaseKeys: [],
      message: "Synthetic profile message for stage timing.",
      answers: {},
      termsAccepted: true,
      termsVersion: "2026-04-20",
      privacyPolicyVersion: "2026-04-20",
      idempotencyKey: randomUUID(),
    },
    { ip: "127.0.0.1", userAgent: "profile-script", correlationId },
  );
  return {
    wallMs: Math.round(performance.now() - t0),
    timing: result.timing ?? null,
    reference: result.reference,
    pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
  };
}

for (let i = 0; i < 3; i++) {
  console.log(JSON.stringify(await runOnce(i)));
}
await pool.end();
