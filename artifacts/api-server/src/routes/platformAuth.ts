/**
 * First-party platform authentication routes (third-party IdP fully removed).
 *
 * All identity for BOTH the CRM (Platform Admin) and Handler surfaces flows
 * through the composed first-party auth platform
 * (`lib/auth/composeAuthPlatform.ts`). A single shared session cookie
 * (`ctx_auth_session`, an opaque refresh token) is issued here and resolved by
 * `requireAuthSession` / `requirePlatformAdmin` / `requireAuth`.
 *
 * Public routes (login, forgot/reset password, verify-email, invite/accept,
 * bootstrap, mfa/challenge, test-login) are registered on this standalone
 * router which is mounted BEFORE the CRM routers so their `requirePlatformAdmin`
 * guard never sees these paths. Authenticated routes attach `requireAuthSession`
 * per-route (session required, but NOT staff linkage — so handler accounts can
 * manage their own password/MFA too).
 *
 * Enumeration safety: login and MFA failures always return a single generic
 * message; forgot-password always returns success regardless of account
 * existence.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  db,
  crmStaffTable,
  crmStaffInvitesTable,
  authBootstrapTokensTable,
  type CrmStaff,
} from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  AUTH_SESSION_COOKIE,
  STAFF_PASSWORD_POLICY,
  bootstrapTokenHash,
  clearAuthSessionCookie,
  getAuthService,
  setAuthSessionCookie,
  type RequestContextInput,
} from "../lib/auth/composeAuthPlatform";
import {
  linkStaffForAuthAccount,
  loadActiveStaffByAuthAccountId,
} from "../middlewares/requirePlatformAdmin";
import { requireAuthSession } from "../middlewares/requireAuthSession";
import { ensureCrmSeeded } from "../lib/crm/seed";
import { writeAudit } from "../lib/crm/audit";
import { ROLE_PERMISSIONS } from "../lib/crm/rbac";
import { logger } from "../lib/logger";
import { AuthDomain } from "@workspace/first-party-auth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requestContext(req: Request): RequestContextInput {
  const ua = req.headers["user-agent"];
  return {
    ipAddress: req.ip,
    userAgent: typeof ua === "string" ? ua : undefined,
  };
}

function staffPayload(s: CrmStaff) {
  const permissions =
    s.permissions && s.permissions.length > 0 ? s.permissions : (ROLE_PERMISSIONS[s.role] ?? []);
  return { id: s.id, email: s.email, name: s.name, role: s.role, permissions };
}

/** Generic auth-failure response (never reveals whether an account exists). */
function genericLoginError(res: Response, error: { code: string; details?: Record<string, unknown> }): void {
  if (error.code === "RATE_LIMITED") {
    const retryMs =
      typeof error.details?.retryAfterMs === "number" ? (error.details.retryAfterMs as number) : undefined;
    if (retryMs && Number.isFinite(retryMs)) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryMs / 1000))));
    }
    res.status(429).json({ error: "Too many attempts. Please try again shortly." });
    return;
  }
  res.status(401).json({ error: "Invalid email or password." });
}

interface AuthenticatedOutcome {
  readonly status: "authenticated";
  readonly tokens: { accessToken: string; accessExpiresAt: number; refreshToken?: string };
  readonly context: { accountId: string; sessionId: string };
}

/**
 * Finish an authenticated login/MFA: set the session cookie, (best-effort) link
 * a CRM staff row, and return the identity payload. Session rotation is implicit
 * because each successful auth mints a brand-new session.
 */
async function finishAuthenticated(
  req: Request,
  res: Response,
  outcome: AuthenticatedOutcome,
): Promise<void> {
  const auth = getAuthService();
  const accountId = outcome.context.accountId;
  const refreshToken =
    outcome.tokens.refreshToken ?? (await auth.mintRefreshForSession(outcome.context.sessionId));
  setAuthSessionCookie(res, refreshToken);
  const email = (await auth.getAccountEmail(accountId)) ?? "";
  let staff: CrmStaff | null = null;
  try {
    staff = await linkStaffForAuthAccount({ email, authAccountId: accountId });
  } catch (err) {
    logger.error({ err }, "staff link on login failed");
  }
  if (staff) {
    void writeAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "auth.login",
      entityType: "session",
      entityId: outcome.context.sessionId,
    }).catch(() => undefined);
  }
  res.json({
    authenticated: true,
    staff: staff ? staffPayload(staff) : null,
    accountId,
  });
}

// ---------------------------------------------------------------------------
// Login (email + password)
// ---------------------------------------------------------------------------

const LoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

router.post("/platform/auth/login", async (req, res, next) => {
  try {
    const parsed = LoginBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    const auth = getAuthService();
    const result = await auth.platform.authentication.loginWithPassword({
      identifier: { kind: "email", value: parsed.data.email },
      password: parsed.data.password,
      context: requestContext(req),
    });
    if (!result.ok) {
      genericLoginError(res, result.error);
      return;
    }
    const outcome = result.value;
    if (outcome.status === "mfa_required") {
      res.json({ mfaRequired: true, accountId: outcome.accountId, methods: outcome.methods });
      return;
    }
    if (outcome.status === "verification_required") {
      res.json({ verificationRequired: true, challengeId: outcome.challengeId });
      return;
    }
    await finishAuthenticated(req, res, outcome as unknown as AuthenticatedOutcome);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// MFA second factor at login (public: no session yet)
// ---------------------------------------------------------------------------

const MfaChallengeBody = z.object({
  accountId: z.string().min(1).max(200),
  method: z.enum(["totp", "sms", "recovery"]).default("totp"),
  code: z.string().min(1).max(64),
});

router.post("/platform/auth/mfa/challenge", async (req, res, next) => {
  try {
    const parsed = MfaChallengeBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(401).json({ error: "Invalid code." });
      return;
    }
    const auth = getAuthService();
    const result = await auth.platform.authentication.submitMfa({
      accountId: parsed.data.accountId as never,
      method: parsed.data.method,
      code: parsed.data.code,
      context: requestContext(req),
    });
    if (!result.ok) {
      if (result.error.code === "RATE_LIMITED") {
        res.status(429).json({ error: "Too many attempts. Please try again shortly." });
        return;
      }
      res.status(401).json({ error: "Invalid code." });
      return;
    }
    const outcome = result.value;
    if (outcome.status !== "authenticated") {
      res.status(401).json({ error: "Invalid code." });
      return;
    }
    await finishAuthenticated(req, res, outcome as unknown as AuthenticatedOutcome);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Logout / logout-all (authenticated)
// ---------------------------------------------------------------------------

router.post("/platform/auth/logout", requireAuthSession, async (req, res, next) => {
  try {
    const auth = getAuthService();
    const cookie = req.cookies?.[AUTH_SESSION_COOKIE] as string | undefined;
    if (cookie) {
      await auth.revokeSessionToken(cookie).catch(() => undefined);
    } else if (req.authAccountId && req.authSessionId) {
      await auth
        .revokeSessionForAccount(req.authAccountId, req.authSessionId)
        .catch(() => undefined);
    }
    clearAuthSessionCookie(res);
    if (req.authAccountId) {
      void writeAudit({
        actorType: "staff",
        actorId: req.authAccountId,
        action: "auth.logout",
        entityType: "session",
        entityId: req.authSessionId ?? req.authAccountId,
      }).catch(() => undefined);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/platform/auth/logout-all", requireAuthSession, async (req, res, next) => {
  try {
    const auth = getAuthService();
    await auth.revokeAllForAccount(req.authAccountId!);
    clearAuthSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Current session identity (authenticated)
// ---------------------------------------------------------------------------

router.get("/platform/auth/session", requireAuthSession, async (req, res, next) => {
  try {
    const auth = getAuthService();
    const accountId = req.authAccountId!;
    const email = (await auth.getAccountEmail(accountId)) ?? null;
    const staff = await loadActiveStaffByAuthAccountId(accountId);
    res.json({
      accountId,
      email,
      sessionId: req.authSessionId ?? null,
      staff: staff ? staffPayload(staff) : null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Session inventory (authenticated)
// ---------------------------------------------------------------------------

router.get("/platform/auth/sessions", requireAuthSession, async (req, res, next) => {
  try {
    const auth = getAuthService();
    const sessions = await auth.listActiveSessions(req.authAccountId!);
    res.json({
      current: req.authSessionId ?? null,
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId ?? null,
        issuedAt: new Date(s.issuedAt).toISOString(),
        expiresAt: new Date(s.expiresAt).toISOString(),
        current: s.id === req.authSessionId,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/platform/auth/sessions/:id", requireAuthSession, async (req, res, next) => {
  try {
    const auth = getAuthService();
    const id = String(req.params.id ?? "");
    const ok = await auth.revokeSessionForAccount(req.authAccountId!, id);
    if (!ok) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (id === req.authSessionId) clearAuthSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Email verification / activation
// ---------------------------------------------------------------------------

const VerifyEmailBody = z.object({
  challengeId: z.string().min(1).max(200),
  code: z.string().min(1).max(64),
});

router.post("/platform/auth/verify-email", async (req, res, next) => {
  try {
    const parsed = VerifyEmailBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid or expired code." });
      return;
    }
    const auth = getAuthService();
    const result = await auth.platform.registration.confirmIdentifier({
      challengeId: parsed.data.challengeId as never,
      code: parsed.data.code,
    });
    if (!result.ok) {
      res.status(400).json({ error: "Invalid or expired code." });
      return;
    }
    res.json({ verified: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Password reset lifecycle
// ---------------------------------------------------------------------------

const ForgotBody = z.object({ email: z.string().email().max(254) });

router.post("/platform/auth/forgot-password", async (req, res, next) => {
  try {
    const parsed = ForgotBody.safeParse(req.body ?? {});
    // Always respond success — never reveal whether the account exists.
    if (parsed.success) {
      const auth = getAuthService();
      try {
        await auth.platform.password.requestReset({
          identifier: { kind: "email", value: parsed.data.email },
          channel: "email",
        });
      } catch (err) {
        logger.error({ err }, "password reset request failed");
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const ResetBody = z.object({
  challengeId: z.string().min(1).max(200),
  code: z.string().min(1).max(64),
  newPassword: z.string().min(1).max(1024),
});

router.post("/platform/auth/reset-password", async (req, res, next) => {
  try {
    const parsed = ResetBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid or expired code." });
      return;
    }
    if (!AuthDomain.isPasswordAcceptable(parsed.data.newPassword, STAFF_PASSWORD_POLICY)) {
      res.status(400).json({ error: AuthDomain.describePasswordPolicy(STAFF_PASSWORD_POLICY) });
      return;
    }
    const auth = getAuthService();
    const result = await auth.platform.password.resetPassword({
      challengeId: parsed.data.challengeId as never,
      code: parsed.data.code,
      newPassword: parsed.data.newPassword,
    });
    if (!result.ok) {
      if (result.error.code === "WEAK_PASSWORD") {
        res.status(400).json({ error: AuthDomain.describePasswordPolicy(STAFF_PASSWORD_POLICY) });
        return;
      }
      // The one-time code is consumed on use; a second attempt therefore fails.
      res.status(400).json({ error: "Invalid or expired code." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
});

router.post("/platform/auth/change-password", requireAuthSession, async (req, res, next) => {
  try {
    const parsed = ChangePasswordBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "currentPassword and newPassword are required." });
      return;
    }
    if (!AuthDomain.isPasswordAcceptable(parsed.data.newPassword, STAFF_PASSWORD_POLICY)) {
      res.status(400).json({ error: AuthDomain.describePasswordPolicy(STAFF_PASSWORD_POLICY) });
      return;
    }
    const auth = getAuthService();
    const result = await auth.platform.password.changePassword({
      accountId: req.authAccountId! as never,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });
    if (!result.ok) {
      if (result.error.code === "WEAK_PASSWORD") {
        res.status(400).json({ error: AuthDomain.describePasswordPolicy(STAFF_PASSWORD_POLICY) });
        return;
      }
      if (result.error.code === "INVALID_CREDENTIALS") {
        res.status(400).json({ error: "Current password is incorrect." });
        return;
      }
      res.status(400).json({ error: "Unable to change password." });
      return;
    }
    // Rotate: invalidate every session (including this one) and force re-login.
    await auth.revokeAllForAccount(req.authAccountId!);
    clearAuthSessionCookie(res);
    res.json({ ok: true, reauthenticate: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// MFA enrollment (authenticated)
// ---------------------------------------------------------------------------

router.post("/platform/auth/mfa/enroll", requireAuthSession, async (req, res, next) => {
  try {
    const auth = getAuthService();
    const accountId = req.authAccountId!;
    const email = (await auth.getAccountEmail(accountId)) ?? accountId;
    const result = await auth.platform.mfa.enrollTotp({
      accountId: accountId as never,
      issuer: auth.issuer,
      label: email,
    });
    if (!result.ok) {
      res.status(400).json({ error: "Unable to start MFA enrollment." });
      return;
    }
    res.json({ otpauthUri: result.value.otpauthUri });
  } catch (err) {
    next(err);
  }
});

const MfaConfirmBody = z.object({ code: z.string().min(1).max(64) });

router.post("/platform/auth/mfa/confirm", requireAuthSession, async (req, res, next) => {
  try {
    const parsed = MfaConfirmBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A verification code is required." });
      return;
    }
    const auth = getAuthService();
    const result = await auth.platform.mfa.confirmTotp({
      accountId: req.authAccountId! as never,
      code: parsed.data.code,
    });
    if (!result.ok) {
      res.status(400).json({ error: "Invalid code." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/platform/auth/mfa/recovery-codes", requireAuthSession, async (req, res, next) => {
  try {
    const auth = getAuthService();
    const result = await auth.platform.mfa.generateRecoveryCodes({
      accountId: req.authAccountId! as never,
    });
    if (!result.ok) {
      res.status(400).json({ error: "Unable to generate recovery codes." });
      return;
    }
    res.json({ codes: result.value.codes });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Invitation acceptance (email-scoped invite + password setup)
// ---------------------------------------------------------------------------

const InviteAcceptBody = z.object({
  token: z.string().min(16).max(400),
  password: z.string().min(1).max(1024),
  name: z.string().max(120).optional(),
});

router.post("/platform/auth/invite/accept", async (req, res, next) => {
  try {
    const parsed = InviteAcceptBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A valid invite token and password are required." });
      return;
    }
    await ensureCrmSeeded();
    const tokenHash = bootstrapTokenHash(parsed.data.token);
    const [invite] = await db
      .select()
      .from(crmStaffInvitesTable)
      .where(
        and(
          eq(crmStaffInvitesTable.tokenHash, tokenHash),
          isNull(crmStaffInvitesTable.acceptedAt),
          gt(crmStaffInvitesTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invite) {
      res.status(400).json({ error: "Invitation not found or expired." });
      return;
    }
    if (!AuthDomain.isPasswordAcceptable(parsed.data.password, STAFF_PASSWORD_POLICY)) {
      res.status(400).json({ error: AuthDomain.describePasswordPolicy(STAFF_PASSWORD_POLICY) });
      return;
    }
    const auth = getAuthService();
    const email = invite.emailNormalized;
    const prov = await auth.provisionAccount({
      email,
      password: parsed.data.password,
    });
    if (!prov.ok || !prov.accountId) {
      res.status(prov.error?.includes("already registered") ? 409 : 400).json({
        error: prov.error ?? "Unable to accept the invitation.",
      });
      return;
    }
    const staff = await linkStaffForAuthAccount({
      email,
      name: parsed.data.name || email.split("@")[0],
      authAccountId: prov.accountId,
    });
    if (!staff) {
      res.status(403).json({ error: "This email is not authorized for Platform Admin." });
      return;
    }
    await db
      .update(crmStaffInvitesTable)
      .set({ acceptedAt: new Date() })
      .where(eq(crmStaffInvitesTable.id, invite.id));
    const { refreshToken } = await auth.issueSessionForAccount(prov.accountId, requestContext(req));
    setAuthSessionCookie(res, refreshToken);
    void writeAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "auth.invite_accepted",
      entityType: "staff",
      entityId: staff.id,
    }).catch(() => undefined);
    res.status(201).json({ authenticated: true, staff: staffPayload(staff) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Bootstrap: single-use token provisions the very first owner
// ---------------------------------------------------------------------------

const BootstrapBody = z.object({
  token: z.string().min(16).max(400),
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

router.post("/platform/auth/bootstrap", async (req, res, next) => {
  try {
    const parsed = BootstrapBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A token, email and password are required." });
      return;
    }
    await ensureCrmSeeded();
    // Bootstrap is only permitted while no staff exist yet.
    const [anyStaff] = await db.select({ id: crmStaffTable.id }).from(crmStaffTable).limit(1);
    if (anyStaff) {
      res.status(409).json({ error: "Bootstrap is closed." });
      return;
    }
    const now = Date.now();
    const tokenHash = bootstrapTokenHash(parsed.data.token);
    const [tokenRow] = await db
      .select()
      .from(authBootstrapTokensTable)
      .where(
        and(
          eq(authBootstrapTokensTable.tokenHash, tokenHash),
          isNull(authBootstrapTokensTable.consumedAt),
          gt(authBootstrapTokensTable.expiresAt, now),
        ),
      )
      .limit(1);
    if (!tokenRow) {
      res.status(401).json({ error: "Invalid or expired bootstrap token." });
      return;
    }
    const auth = getAuthService();
    const prov = await auth.provisionAccount({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (!prov.ok || !prov.accountId) {
      res.status(400).json({ error: prov.error ?? "Unable to bootstrap the owner account." });
      return;
    }
    const staff = await linkStaffForAuthAccount({
      email: parsed.data.email,
      authAccountId: prov.accountId,
    });
    if (!staff) {
      res.status(500).json({ error: "Failed to create the owner staff record." });
      return;
    }
    // Consume the single-use token (guard against races via consumedAt IS NULL).
    const consumed = await db
      .update(authBootstrapTokensTable)
      .set({ consumedAt: now, consumedByAccountId: prov.accountId })
      .where(
        and(
          eq(authBootstrapTokensTable.id, tokenRow.id),
          isNull(authBootstrapTokensTable.consumedAt),
        ),
      )
      .returning({ id: authBootstrapTokensTable.id });
    if (consumed.length === 0) {
      res.status(409).json({ error: "Bootstrap token already used." });
      return;
    }
    const { refreshToken } = await auth.issueSessionForAccount(prov.accountId, requestContext(req));
    setAuthSessionCookie(res, refreshToken);
    void writeAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "auth.bootstrap",
      entityType: "staff",
      entityId: staff.id,
    }).catch(() => undefined);
    res.status(201).json({ authenticated: true, staff: staffPayload(staff) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Non-production e2e login: mint a real first-party session for a staff row.
// ---------------------------------------------------------------------------

router.post("/platform/auth/test-login", async (req, res, next) => {
  try {
    if (process.env.CRM_HTTP_TEST_AUTH !== "true" || process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const staffId = typeof req.body?.staffId === "string" ? req.body.staffId : "";
    if (!staffId || staffId.length < 10) {
      res.status(400).json({ error: "staffId required" });
      return;
    }
    const [row] = await db.select().from(crmStaffTable).where(eq(crmStaffTable.id, staffId)).limit(1);
    if (!row || row.status !== "active") {
      res.status(404).json({ error: "Staff not found" });
      return;
    }
    const auth = getAuthService();
    let accountId = row.authAccountId ?? null;
    if (!accountId) {
      // Provision an ephemeral first-party account so a real session can be
      // issued. The random password is never surfaced; e2e uses the cookie.
      const ephemeralPassword = `Aa1${randomUUID()}${randomUUID()}`;
      const prov = await auth.provisionAccount({ email: row.email, password: ephemeralPassword });
      if (!prov.ok || !prov.accountId) {
        res.status(500).json({ error: prov.error ?? "Unable to provision test account." });
        return;
      }
      accountId = prov.accountId;
      const linked = await linkStaffForAuthAccount({ email: row.email, authAccountId: accountId });
      if (!linked) {
        res.status(500).json({ error: "Unable to link test staff account." });
        return;
      }
    }
    const { refreshToken } = await auth.issueSessionForAccount(accountId, requestContext(req));
    setAuthSessionCookie(res, refreshToken);
    res.json(staffPayload(row));
  } catch (err) {
    next(err);
  }
});

export default router;
