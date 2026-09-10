import type { NextFunction, Request, Response } from "express";
import {
  db,
  crmStaffTable,
  crmTeamsTable,
  crmTeamMembersTable,
  crmStaffInvitesTable,
  type CrmStaff,
} from "@workspace/db";
import { and, eq, isNull, gt } from "drizzle-orm";
import { ROLE_PERMISSIONS, hasPermission, type PlatformPermission } from "../lib/crm/rbac";
import { writeAudit } from "../lib/crm/audit";
import { logger } from "../lib/logger";
import { isCrmHttpTestAuthAllowed } from "../lib/crm/authFlags";
import { isCredentialedOriginAllowed } from "../lib/crm/corsOrigin";
import { resolvePrincipal } from "./requireAuthSession";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformStaff?: CrmStaff;
      rawBody?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Staff <-> first-party auth account linkage
//
// Platform Admin (CRM) identity is backed by the first-party auth platform
// (`@workspace/first-party-auth`) composed in
// `lib/auth/composeAuthPlatform.ts`. A `crm_staff` row is linked to exactly one
// auth account via `crm_staff.auth_account_id`. The shared session cookie
// (`ctx_auth_session`) is resolved by `resolvePrincipal` → auth accountId →
// this linkage → the staff row.
// ---------------------------------------------------------------------------

export function allowedEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
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

/** Load the active staff row linked to a first-party auth account, if any. */
export async function loadActiveStaffByAuthAccountId(
  authAccountId: string,
): Promise<CrmStaff | null> {
  const [row] = await db
    .select()
    .from(crmStaffTable)
    .where(eq(crmStaffTable.authAccountId, authAccountId))
    .limit(1);
  if (!row || row.status !== "active") return null;
  return row;
}

/**
 * Link a freshly-authenticated first-party account to a `crm_staff` row by
 * email, honouring the same authorization gates the retired IdP path enforced
 * (allow-list / pending invite / bootstrap). Returns the active staff row, or
 * `null` when the email is not authorized for Platform Admin.
 *
 * Idempotent: on repeat logins it just refreshes `lastLoginAt` and (re)binds
 * `authAccountId` when missing.
 */
export async function linkStaffForAuthAccount(params: {
  email: string;
  name?: string;
  authAccountId: string;
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
    // Refuse to hijack a staff row already bound to a different account.
    if (existing.authAccountId && existing.authAccountId !== params.authAccountId) {
      logger.warn(
        { staffId: existing.id },
        "staff already linked to a different auth account; refusing rebind",
      );
      return null;
    }
    const patch: Partial<typeof crmStaffTable.$inferInsert> = {
      lastLoginAt: new Date(),
      name: params.name || existing.name,
    };
    if (!existing.authAccountId) patch.authAccountId = params.authAccountId;
    const [updated] = await db
      .update(crmStaffTable)
      .set(patch)
      .where(eq(crmStaffTable.id, existing.id))
      .returning();
    await ensureOnSalesTeam(updated.id);
    return updated;
  }

  // No staff row yet — create one only if authorized.
  const bootstrapOpen = allow.size === 0 && process.env.NODE_ENV !== "production";
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
      authAccountId: params.authAccountId,
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
    // Non-production e2e bypass: trust an explicit staff id header.
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

    // First-party session (shared `ctx_auth_session` cookie or Bearer opaque
    // token) → auth accountId → linked crm_staff row.
    const principal = await resolvePrincipal(req);
    if (principal) {
      req.authAccountId = principal.accountId;
      req.authSessionId = principal.sessionId;
      const staff = await loadActiveStaffByAuthAccountId(principal.accountId);
      if (staff) {
        req.platformStaff = staff;
        next();
        return;
      }
    }

    res.status(401).json({ error: "Unauthorized" });
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
