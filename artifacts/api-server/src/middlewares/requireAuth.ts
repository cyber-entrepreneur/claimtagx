import type { NextFunction, Request, Response } from "express";
import { getAuthService } from "../lib/auth/composeAuthPlatform";
import { resolvePrincipal } from "./requireAuthSession";
import { listMemberships, type MembershipRow } from "../lib/memberships";

export type VenueMembership = MembershipRow;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userName?: string;
      venues?: VenueMembership[];
    }
  }
}

/**
 * Handler authentication — first-party only.
 *
 * Identity is resolved from the SAME first-party session that serves the CRM:
 * the shared `ctx_auth_session` cookie (an opaque refresh token) or an
 * `Authorization: Bearer` opaque token (access or refresh). `req.userId` is set
 * to the first-party AUTH ACCOUNT ID.
 *
 * NOTE ON `handler_user_id`: rows created after this change store first-party
 * account ids in `handler_venues.handler_user_id` (and related columns). Any
 * pre-existing third-party IdP ids remain as opaque strings until a data migration maps
 * them onto auth accounts. See docs/first-party-auth/HANDLER_IDENTITY.md.
 */
export async function requireAuth(
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
    const auth = getAuthService();
    const email = (await auth.getAccountEmail(principal.accountId)) ?? "";
    const fullName = email ? email.split("@")[0] : "Handler";
    req.userId = principal.accountId;
    req.authAccountId = principal.accountId;
    req.authSessionId = principal.sessionId;
    req.userEmail = email;
    req.userName = fullName;
    req.venues = await listMemberships(principal.accountId);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireVenueMembership(
  paramName = "venueCode",
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const code = String(req.params[paramName] ?? "").toUpperCase();
    if (!code) {
      res.status(400).json({ error: "Venue code required" });
      return;
    }
    const venues = req.venues ?? [];
    if (!venues.some((v) => v.code === code)) {
      res.status(403).json({ error: "Not a member of this venue" });
      return;
    }
    next();
  };
}

export function requireVenueRole(
  roles: string[],
  paramName = "venueCode",
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const code = String(req.params[paramName] ?? "").toUpperCase();
    const venue = (req.venues ?? []).find((v) => v.code === code);
    if (!venue) {
      res.status(403).json({ error: "Not a member of this venue" });
      return;
    }
    if (!roles.includes(venue.role)) {
      res.status(403).json({ error: "Insufficient role for this venue" });
      return;
    }
    next();
  };
}
