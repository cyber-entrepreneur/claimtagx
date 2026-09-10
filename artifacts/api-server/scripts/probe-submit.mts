import { submitInquiry } from "../src/lib/crm/orchestrator.ts";
import { pool, db, crmInquiryCountersTable, crmInquiriesTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

const counters = await db.select().from(crmInquiryCountersTable);
console.log("counters", counters);
const [latest] = await db.select({ reference: crmInquiriesTable.reference }).from(crmInquiriesTable).orderBy(desc(crmInquiriesTable.createdAt)).limit(1);
console.log("latest", latest);
try {
  const r = await submitInquiry({
    firstName: "T", lastName: "U", jobTitle: "E", companyName: "C",
    email: `direct.${Date.now()}@example.com`, country: "US", phoneRaw: "+14155552671",
    inquiryType: "general", useCaseKeys: [], message: "Direct submit probe message long enough.",
    answers: {}, termsAccepted: true, termsVersion: "2026-04-20", privacyPolicyVersion: "2026-04-20",
    idempotencyKey: crypto.randomUUID(),
  }, { ip: "127.0.0.1", userAgent: "probe", correlationId: "probe-1" });
  console.log("OK", r.reference);
} catch (e) {
  console.error("FAIL", e);
}
await pool.end();
