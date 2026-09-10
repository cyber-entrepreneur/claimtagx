import type { NextFunction, Request, Response } from "express";
import { AUTH_SESSION_COOKIE, getAuthService, type ResolvedSession } from "../lib/auth/composeAuthPlatform";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** First-party auth account id resolved from the session, not a third-party IdP id. */
      authAccountId?: string;
      /** First-party session id backing the current request, when known. */
      authSessionId?: string;
    }
  }
}

/**
 * Resolve the first-party principal from either the shared session cookie
 * (`ctx_auth_session`, an opaque refresh token) or a `Bearer` opaque token
 * (access or refresh). Returns `null` when no valid session is present.
 *
 * This is the single source of truth for "who is calling" and is shared by the
 * CRM (`requirePlatformAdmin`) and Handler (`requireAuth`) middleware so ONE
 * identity system serves both surfaces.
 */
export async function resolvePrincipal(req: Request): Promise<ResolvedSession | null> {
  const auth = getAuthService();
  const cookie = req.cookies?.[AUTH_SESSION_COOKIE] as string | undefined;
  if (cookie) {
    const viaCookie = await auth.resolveSessionToken(cookie);
    if (viaCookie) return viaCookie;
  }
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) {
      // Access tokens are short-lived; refresh tokens back long web sessions.
      const viaAccess = await auth.resolveAccessToken(token);
      if (viaAccess) return viaAccess;
      const viaRefresh = await auth.resolveSessionToken(token);
      if (viaRefresh) return viaRefresh;
    }
  }
  return null;
}

/** Express middleware: require any valid first-party session; sets req.authAccountId. */
export async function requireAuthSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const principal = await resolvePrincipal(req);
    if (!principal) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.authAccountId = principal.accountId;
    req.authSessionId = principal.sessionId;
    next();
  } catch (err) {
    next(err);
  }
}
