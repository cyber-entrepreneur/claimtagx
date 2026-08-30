import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db, crmStaffTable, crmTeamsTable, crmTeamMembersTable, type CrmStaff } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ROLE_PERMISSIONS, hasPermission, type PlatformPermission } from "../lib/crm/rbac";
import { logger } from "../lib/logger";

const COOKIE = "ctx_platform_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformStaff?: CrmStaff;
    }
  }
}

interface SessionPayload {
  staffId: string;
  email: string;
  exp: number;
}

function sessionSecret(): string | null {
  return (
    process.env.PLATFORM_STAFF_SESSION_SECRET?.trim() ||
    process.env.PLATFORM_STAFF_ACCESS_KEY?.trim() ||
    null
  );
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
  const secret = sessionSecret();
  if (!secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = signPayload(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.staffId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setStaffSessionCookie(res: Response, staff: CrmStaff): void {
  const token = encodeStaffSession({
    staffId: staff.id,
    email: staff.emailNormalized,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
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
  if (allow.size > 0 && !allow.has(emailNormalized) && !bootstrapOpen) {
    return null;
  }
  if (allow.size === 0 && process.env.NODE_ENV === "production") {
    return null;
  }
  const [countRow] = await db.select({ id: crmStaffTable.id }).from(crmStaffTable).limit(1);
  const role = countRow ? "sales" : "owner";
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
  const list = process.env.CORS_ALLOWED_ORIGINS ?? "";
  const allowed = new Set(
    list
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((v) => (v.startsWith("http") ? v : `https://${v}`)),
  );
  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost:5173");
    allowed.add("http://localhost:8080");
    allowed.add("http://127.0.0.1:5173");
  }
  return allowed.has(origin);
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
    let staff: CrmStaff | null = null;
    const cookie = req.cookies?.[COOKIE] as string | undefined;
    if (cookie) {
      const session = decodeStaffSession(cookie);
      if (session) {
        const [row] = await db
          .select()
          .from(crmStaffTable)
          .where(eq(crmStaffTable.id, session.staffId))
          .limit(1);
        if (row && row.status === "active") staff = row;
      }
    }
    if (!staff) staff = await staffFromClerk(req);
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
    if (!hasPermission(staff.permissions, permission)) {
      res.status(403).json({ error: "Insufficient permission" });
      return;
    }
    next();
  };
}
