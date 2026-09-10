/**
 * Seed local admin E2E staff (JSON stdout). Uses psql CLI — no Node pg dependency.
 * Isolated verify DB only.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL ?? "";
if (
  !/127\.0\.0\.1:(55432|55470)/.test(url) ||
  !/claimtagx_crm_verify|claimtagx_crm_e2e|claimtagx_crm_omni|ctx_e2e_[a-f0-9]{8}/.test(url)
) {
  console.error("Refusing seed outside isolated verify/e2e database on 55432|55470");
  process.exit(1);
}

const u = new URL(url);
const pgBin = process.env.PG_BIN || "C:\\Users\\AliAchkar\\scoop\\apps\\postgresql16\\current\\bin\\psql.exe";

const ROLE_PERMISSIONS = {
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
    "marketing.write",
    "attachments.manage",
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

const roleDb = {
  admin: "admin",
  sales: "sales",
  analyst: "analyst",
  cmsAuthor: "administrator",
  cmsReviewer: "administrator",
  cmsPublisher: "administrator",
};

function psql(sql) {
  const raw = execFileSync(
    pgBin,
    ["-h", u.hostname, "-p", u.port, "-U", decodeURIComponent(u.username), "-d", u.pathname.replace(/^\//, ""), "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) },
      encoding: "utf8",
    },
  );
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^[0-9a-f-]{36}$/i.test(l));
  if (!line) throw new Error(`psql returned no uuid for: ${sql.slice(0, 80)} => ${raw}`);
  return line;
}

const suffix = randomUUID().slice(0, 8);
const out = {};
for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
  const email = `e2e.${role}.${suffix}@example.com`;
  const perms = JSON.stringify(permissions).replace(/'/g, "''");
  const id = psql(
    `INSERT INTO crm_staff (email, email_normalized, name, role, permissions, status)
     VALUES ('${email}', '${email.toLowerCase()}', 'E2E ${role}', '${roleDb[role]}', '${perms}'::jsonb, 'active')
     RETURNING id;`,
  );
  if (!id) throw new Error(`insert failed for ${role}`);
  out[role] = { id, email, permissions };
}
process.stdout.write(JSON.stringify(out));
