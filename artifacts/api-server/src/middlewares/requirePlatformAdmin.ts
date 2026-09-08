import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db, crmStaffTable, crmTeamsTable, crmTeamMembersTable, crmStaffInvitesTable, crmSessionRevocationsTable, type CrmStaff } from "@workspace/db";
import { and, eq, isNull, gt } from "drizzle-orm";
import { ROLE_PERMISSIONS, hasPermission, type PlatformPermission } from "../lib/crm/rbac";
import { writeAudit } from "../lib/crm/audit";
import { logger } from "../lib/logger";
import { isCrmHttpTestAuthAllowed } from "../lib/crm/authFlags";
import { isCredentialedOriginAllowed } from "../lib/crm/corsOrigin";

const COOKIE = "ctx_platform_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformStaff?: CrmStaff;
      rawBody?: string;
    }
  }
}

interface SessionPayload {
  staffId: string;
  email: string;
  iat: number;
  exp: number;
}

function sessionSecrets(): string[] {
  const current = process.env.PLATFORM_STAFF_SESSION_SECRET?.trim();
  const previous = process.env.PLATFORM_STAFF_SESSION_SECRET_PREVIOUS?.trim();
  const out: string[] = [];
  if (current) out.push(current);
  if (previous && previous !== current) out.push(previous);
  if (!out.length && process.env.NODE_ENV !== "production") {
    const fallback = process.env.PLATFORM_STAFF_ACCESS_KEY?.trim();
    if (fallback) out.push(fallback);
  }
  return out;
}

function sessionSecret(): string | null {
  return sessionSecrets()[0] ?? null;
}

function signPayload(json: string, secret: string): string {
  return createHmac("sha256", secret).update(json).digest("base64url");
}

export function encodeStaffSession(payload: SessionPayload): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const json = JSON.stringify(payload);
  const body = Buffer.from(json).toString("base64url");
  return `${body}.${signPayload(body, secret)}`;
}

export function decodeStaffSession(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  let matched = false;
  for (const secret of sessionSecrets()) {
    const expected = signPayload(body, secret);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      matched = true;
      break;
    }
  }
  if (!matched) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.staffId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function revokeStaffSessions(staffId: string): Promise<void> {
  await db
    .insert(crmSessionRevocationsTable)
    .values({ staffId, revokedBefore: new Date() })
    .onConflictDoUpdate({
      target: crmSessionRevocationsTable.staffId,
      set: { revokedBefore: new Date() },
    });
}

async function sessionIsRevoked(payload: SessionPayload): Promise<boolean> {
  const [row] = await db
    .select()
    .from(crmSessionRevocationsTable)
    .where(eq(crmSessionRevocationsTable.staffId, payload.staffId))
    .limit(1);
  if (!row) return false;
  const issuedAt = typeof payload.iat === "number" ? payload.iat : 0;
  return issuedAt <= row.revokedBefore.getTime();
}

export function setStaffSessionCookie(res: Response, staff: CrmStaff): void {
  const now = Date.now();
  const token = encodeStaffSession({
    staffId: staff.id,
    email: staff.emailNormalized,
    iat: now,
    exp: now + 7 * 24 * 60 * 60 * 1000,
  });
  if (!token) return;
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearStaffSessionCookie(res: Response): void {
  res.clearCookie(COOKIE, { path: "/" });
}

function allowedEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function upsertStaffFromIdentity(params: {
  email: string;
  name: string;
  clerkUserId?: string;
}): Promise<CrmStaff | null> {
  const emailNormalized = params.email.trim().toLowerCase();
  if (!emailNormalized) return null;
  const allow = allowedEmails();
  const [existing] = await db
    .select()
    .from(crmStaffTable)
    .where(eq(crmStaffTable.emailNormalized, emailNormalized))
    .limit(1);
  if (existing) {
    if (existing.status !== "active") return null;
    const patch: Partial<typeof crmStaffTable.$inferInsert> = {
      lastLoginAt: new Date(),
      name: params.name || existing.name,
    };
    if (params.clerkUserId && !existing.clerkUserId) patch.clerkUserId = params.clerkUserId;
    const [updated] = await db
      .update(crmStaffTable)
      .set(patch)
      .where(eq(crmStaffTable.id, existing.id))
      .returning();
    await ensureOnSalesTeam(updated.id);
    return updated;
  }
  const bootstrapOpen =
    allow.size === 0 && process.env.NODE_ENV !== "production";
  const [invite] = await db
    .select()
    .from(crmStaffInvitesTable)
    .where(
      and(
        eq(crmStaffInvitesTable.emailNormalized, emailNormalized),
        isNull(crmStaffInvitesTable.acceptedAt),
        gt(crmStaffInvitesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (allow.size > 0 && !allow.has(emailNormalized) && !invite && !bootstrapOpen) {
    return null;
  }
  if (allow.size === 0 && process.env.NODE_ENV === "production" && !invite) {
    return null;
  }
  const [countRow] = await db.select({ id: crmStaffTable.id }).from(crmStaffTable).limit(1);
  const role = invite?.role || (countRow ? "sales" : "owner");
  const [created] = await db
    .insert(crmStaffTable)
    .values({
      email: params.email.trim(),
      emailNormalized,
      name: params.name || emailNormalized.split("@")[0],
      role,
      permissions: ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.sales,
      clerkUserId: params.clerkUserId,
      lastLoginAt: new Date(),
    })
    .returning();
  const [team] = await db
    .select()
    .from(crmTeamsTable)
    .where(eq(crmTeamsTable.slug, "sales"))
    .limit(1);
  if (team) {
    await db
      .insert(crmTeamMembersTable)
      .values({ teamId: team.id, staffId: created.id })
      .onConflictDoNothing();
  }
  if (invite) {
    await db
      .update(crmStaffInvitesTable)
      .set({ acceptedAt: new Date() })
      .where(eq(crmStaffInvitesTable.id, invite.id));
  }
  return created;
}

async function ensureOnSalesTeam(staffId: string): Promise<void> {
  const [team] = await db
    .select()
    .from(crmTeamsTable)
    .where(eq(crmTeamsTable.slug, "sales"))
    .limit(1);
  if (!team) return;
  await db
    .insert(crmTeamMembersTable)
    .values({ teamId: team.id, staffId })
    .onConflictDoNothing();
}

async function staffFromClerk(req: Request): Promise<CrmStaff | null> {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) return null;
    const user = await clerkClient.users.getUser(userId);
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      "";
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.username ||
      email.split("@")[0];
    return upsertStaffFromIdentity({ email, name, clerkUserId: userId });
  } catch {
    return null;
  }
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  return isCredentialedOriginAllowed(origin);
}

export async function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!originAllowed(req)) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    if (process.env.CRM_HTTP_TEST_AUTH === "true" && process.env.NODE_ENV === "production") {
      throw new Error("CRM_HTTP_TEST_AUTH is forbidden in production");
    }
    if (isCrmHttpTestAuthAllowed() && process.env.NODE_ENV !== "production") {
      const testId = req.headers["x-crm-test-staff-id"];
      if (typeof testId === "string" && testId.length > 10) {
        const [row] = await db.select().from(crmStaffTable).where(eq(crmStaffTable.id, testId)).limit(1);
        if (row && row.status === "active") {
          req.platformStaff = row;
          next();
          return;
        }
      }
    }
    let staff: CrmStaff | null = await staffFromClerk(req);
    if (!staff) {
      const cookie = req.cookies?.[COOKIE] as string | undefined;
      if (cookie) {
        const session = decodeStaffSession(cookie);
        if (session && !(await sessionIsRevoked(session))) {
          const [row] = await db
            .select()
            .from(crmStaffTable)
            .where(eq(crmStaffTable.id, session.staffId))
            .limit(1);
          if (row && row.status === "active") staff = row;
        }
      }
    }
    if (!staff) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.platformStaff = staff;
    next();
  } catch (err) {
    logger.error({ err }, "platform admin auth failed");
    next(err);
  }
}

export function requirePermission(permission: PlatformPermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const staff = req.platformStaff;
    if (!staff) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const granted =
      staff.permissions && staff.permissions.length > 0
        ? staff.permissions
        : (ROLE_PERMISSIONS[staff.role] ?? []);
    if (!hasPermission(granted, permission)) {
      void writeAudit({
        actorType: "staff",
        actorId: staff.id,
        action: "auth.permission_denied",
        entityType: "permission",
        entityId: permission,
        afterValue: { path: req.path, method: req.method, role: staff.role },
      }).catch(() => undefined);
      res.status(403).json({ error: "Insufficient permission" });
      return;
    }
    next();
  };
}
