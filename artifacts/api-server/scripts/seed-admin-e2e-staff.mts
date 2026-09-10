/**
 * Seed local admin E2E staff identities (JSON on stdout for Playwright beforeAll).
 * Isolated verify DB only - not hosted-IdP evidence.
 */
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (
  !/127\.0\.0\.1:(55432|55470)/.test(url) ||
  !/claimtagx_crm_verify|claimtagx_crm_e2e|claimtagx_crm_omni|ctx_e2e_[a-f0-9]{8}/.test(url)
) {
  console.error("Refusing seed outside isolated verify/e2e database on 55432|55470");
  process.exit(1);
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    "inquiries.view",
    "inquiries.assign",
    "inquiries.status",
    "inquiries.priority",
    "inquiries.reply",
    "inquiries.note",
    "inquiries.forward",
    "inquiries.tags",
    "inquiries.qualification.override",
    "inquiries.export",
    "inquiries.delete",
    "analytics.view",
    "jobs.inspect",
    "jobs.replay",
    "config.manage",
    "config.propose",
    "templates.manage",
    "governance.dsar",
    "privacy.dsar",
    "marketing.read",
    "marketing.propose",
    "marketing.review",
    "marketing.publish",
    "channels.manage",
  ],
  sales: [
    "inquiries.view",
    "inquiries.assign",
    "inquiries.status",
    "inquiries.priority",
    "inquiries.reply",
    "inquiries.note",
    "inquiries.forward",
    "inquiries.tags",
  ],
  analyst: ["inquiries.view", "inquiries.lead_score.view", "analytics.view"],
  cmsAuthor: ["marketing.read", "marketing.propose"],
  cmsReviewer: ["marketing.read", "marketing.review"],
  cmsPublisher: ["marketing.read", "marketing.publish"],
};

async function main() {
  const { db, crmStaffTable } = await import("@workspace/db");
  const suffix = randomUUID().slice(0, 8);
  const out: Record<string, { id: string; email: string; permissions: string[] }> = {};

  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    const email = `e2e.${role}.${suffix}@example.com`;
    const [row] = await db
      .insert(crmStaffTable)
      .values({
        email,
        emailNormalized: email.toLowerCase(),
        name: `E2E ${role}`,
        role:
          role === "sales" ? "sales" : role === "analyst" ? "analyst" : role === "admin" ? "admin" : "administrator",
        permissions,
      })
      .returning();
    if (!row) throw new Error(`insert failed for ${role}`);
    out[role] = { id: row.id, email, permissions };
  }

  process.stdout.write(JSON.stringify(out));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
