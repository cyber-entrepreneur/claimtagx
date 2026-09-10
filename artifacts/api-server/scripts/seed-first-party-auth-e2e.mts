/**
 * Seed first-party auth E2E identities.
 *
 * Refuses to run outside isolated local verification databases. The JSON output
 * includes only E2E credentials/tokens needed to drive browser journeys.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  Argon2idPasswordHasher,
  AuthDomain,
} from "@workspace/first-party-auth";
import {
  authRateLimitsTable,
  authVerificationsTable,
  crmStaffInvitesTable,
  crmStaffTable,
  db,
  pool,
} from "@workspace/db";
import { STAFF_PASSWORD_POLICY, bootstrapTokenHash } from "../src/lib/auth/composeAuthPlatform.ts";
import { ROLE_PERMISSIONS } from "../src/lib/crm/rbac.ts";

const url = process.env.DATABASE_URL ?? "";
if (
  !/127\.0\.0\.1:(55432|55470)/.test(url) ||
  !/claimtagx_crm_verify|claimtagx_crm_e2e|claimtagx_crm_omni|ctx_e2e_[a-f0-9]{8}/.test(url)
) {
  console.error("Refusing seed outside isolated verify/e2e database on 55432|55470");
  process.exit(1);
}

const PASSWORD = "ClaimTagX-E2E-Passw0rd!";
const RESET_PASSWORD = "ClaimTagX-E2E-Reset1!";
const RESET_CODE = "123456";
const EXPIRED_RESET_CODE = "654321";

if (!AuthDomain.isPasswordAcceptable(PASSWORD, STAFF_PASSWORD_POLICY)) {
  throw new Error("E2E password no longer satisfies STAFF_PASSWORD_POLICY");
}

type SeedStaff = {
  id: string;
  accountId: string;
  email: string;
  role: string;
  status: string;
  permissions: string[];
};

function argon2Params(): { memoryCost: number; timeCost: number; parallelism: number } {
  const intEnv = (name: string, fallback: number) => {
    const raw = process.env[name];
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    memoryCost: intEnv("AUTH_ARGON2_MEMORY_KIB", 19_456),
    timeCost: intEnv("AUTH_ARGON2_TIME_COST", 2),
    parallelism: intEnv("AUTH_ARGON2_PARALLELISM", 1),
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function createStaffAccount(params: {
  suffix: string;
  key: string;
  role: string;
  status?: string;
  permissions?: string[];
}): Promise<SeedStaff> {
  const { getAuthService } = await import("../src/lib/auth/composeAuthPlatform.ts");
  const auth = getAuthService();
  const email = normalizeEmail(`e2e.${params.key}.${params.suffix}@example.com`);
  const provisioned = await auth.provisionAccount({ email, password: PASSWORD });
  if (!provisioned.ok || !provisioned.accountId) {
    throw new Error(`Unable to provision ${email}: ${provisioned.error ?? "unknown error"}`);
  }
  const permissions = params.permissions ?? ROLE_PERMISSIONS[params.role] ?? ROLE_PERMISSIONS.sales;
  const [staff] = await db
    .insert(crmStaffTable)
    .values({
      authAccountId: provisioned.accountId,
      email,
      emailNormalized: email,
      name: `E2E ${params.key}`,
      role: params.role,
      permissions,
      status: params.status ?? "active",
    })
    .returning();
  if (!staff) throw new Error(`Staff insert failed for ${email}`);
  return {
    id: staff.id,
    accountId: provisioned.accountId,
    email,
    role: staff.role,
    status: staff.status,
    permissions,
  };
}

async function createInvite(params: {
  suffix: string;
  key: string;
  expiresAt: Date;
}): Promise<{ email: string; token: string }> {
  const token = `invite_${params.key}_${params.suffix}_${randomUUID()}`;
  const email = normalizeEmail(`e2e.invite.${params.key}.${params.suffix}@example.com`);
  await db
    .insert(crmStaffInvitesTable)
    .values({
      emailNormalized: email,
      role: "sales",
      tokenHash: bootstrapTokenHash(token),
      expiresAt: params.expiresAt,
    })
    .onConflictDoNothing();
  return { email, token };
}

async function createResetChallenge(params: {
  accountId: string;
  email: string;
  code: string;
  expiresAt: number;
}): Promise<{ challengeId: string; code: string; token: string }> {
  const hasher = new Argon2idPasswordHasher(argon2Params());
  const challengeId = randomUUID();
  const now = Date.now();
  await db
    .insert(authVerificationsTable)
    .values({
      id: challengeId,
      accountId: params.accountId,
      channel: "email",
      destination: params.email,
      purpose: "password_reset",
      codeHashRef: await hasher.hash(params.code),
      createdAt: now,
      expiresAt: params.expiresAt,
      attempts: 0,
      maxAttempts: 5,
    })
    .onConflictDoNothing();
  return { challengeId, code: params.code, token: `${challengeId}.${params.code}` };
}

/** Login rate-limit keys that would poison every localhost attempt if left exhausted. */
const LOGIN_IP_RATE_LIMIT_KEYS = [
  "login:::ffff:127.0.0.1",
  "login:127.0.0.1",
  "login:::1",
  "login:::ffff:127.0.0.1:0",
  "login:127.0.0.1:0",
] as const;

async function clearLoginIpRateLimits(): Promise<string[]> {
  for (const key of LOGIN_IP_RATE_LIMIT_KEYS) {
    await db.delete(authRateLimitsTable).where(eq(authRateLimitsTable.key, key));
  }
  return [...LOGIN_IP_RATE_LIMIT_KEYS];
}

/**
 * Exhaust IP buckets for the rate-limit journey only.
 * Do NOT leave these seeded across the suite — AuthenticationService keys by
 * `login:${ip}` when an IP is present, so exhausted IP buckets block all logins.
 */
async function exhaustLoginIpRateLimits(): Promise<string[]> {
  const lastRefillMs = Date.now() + 60_000;
  for (const key of LOGIN_IP_RATE_LIMIT_KEYS) {
    await db
      .insert(authRateLimitsTable)
      .values({ key, tokens: 0, lastRefillMs })
      .onConflictDoUpdate({
        target: authRateLimitsTable.key,
        set: { tokens: 0, lastRefillMs },
      });
  }
  return [...LOGIN_IP_RATE_LIMIT_KEYS];
}

async function seedRateLimitBuckets(): Promise<string[]> {
  // Email-keyed bucket is informative for inventory; runtime uses IP when present.
  const keys = ["login:e2e.ratelimited@example.com"];
  const lastRefillMs = Date.now() + 60_000;
  for (const key of keys) {
    await db
      .insert(authRateLimitsTable)
      .values({ key, tokens: 0, lastRefillMs })
      .onConflictDoUpdate({
        target: authRateLimitsTable.key,
        set: { tokens: 0, lastRefillMs },
      });
  }
  await clearLoginIpRateLimits();
  return keys;
}

async function main() {
  if (process.argv.includes("--clear-login-ip")) {
    const cleared = await clearLoginIpRateLimits();
    process.stdout.write(JSON.stringify({ cleared }));
    return;
  }
  if (process.argv.includes("--exhaust-login-ip")) {
    const exhausted = await exhaustLoginIpRateLimits();
    process.stdout.write(JSON.stringify({ exhausted }));
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const owner = await createStaffAccount({ suffix, key: "owner", role: "owner" });
  const staff = await createStaffAccount({ suffix, key: "staff", role: "admin" });
  const resetStaff = await createStaffAccount({ suffix, key: "reset", role: "admin" });
  const mfaStaff = await createStaffAccount({ suffix, key: "mfa", role: "admin" });
  const lowPrivilege = await createStaffAccount({ suffix, key: "sales", role: "sales" });
  const pendingActivation = await createStaffAccount({
    suffix,
    key: "pending",
    role: "sales",
    status: "pending_activation",
  });
  const suspended = await createStaffAccount({
    suffix,
    key: "suspended",
    role: "sales",
    status: "suspended",
  });

  const invite = await createInvite({
    suffix,
    key: "valid",
    expiresAt: new Date(now + 30 * 60 * 1000),
  });
  const expiredInvite = await createInvite({
    suffix,
    key: "expired",
    expiresAt: new Date(now - 60_000),
  });
  const reset = await createResetChallenge({
    accountId: resetStaff.accountId,
    email: resetStaff.email,
    code: RESET_CODE,
    expiresAt: now + 30 * 60 * 1000,
  });
  const expiredReset = await createResetChallenge({
    accountId: resetStaff.accountId,
    email: resetStaff.email,
    code: EXPIRED_RESET_CODE,
    expiresAt: now - 60_000,
  });
  const rateLimitKeys = await seedRateLimitBuckets();

  // Avoid leaking unrelated historical rate-limit state for seeded accounts.
  for (const staffRow of [owner, staff, resetStaff, mfaStaff, lowPrivilege, pendingActivation, suspended]) {
    await db.delete(authRateLimitsTable).where(eq(authRateLimitsTable.key, `login:${staffRow.email}`));
  }

  process.stdout.write(
    JSON.stringify({
      password: PASSWORD,
      resetPassword: RESET_PASSWORD,
      owner,
      staff,
      resetStaff,
      mfaStaff,
      lowPrivilege,
      pendingActivation,
      suspended,
      invite,
      expiredInvite,
      reset,
      expiredReset,
      invalidInviteToken: `invite_invalid_${suffix}_${randomUUID()}`,
      invalidResetToken: `${randomUUID()}.000000`,
      rateLimitedEmail: "e2e.ratelimited@example.com",
      rateLimitKeys,
    }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
