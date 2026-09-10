import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireVenueRole,
} from "../middlewares/requireAuth";
import { getAuthService } from "../lib/auth/composeAuthPlatform";
import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  listPendingInvitationsForEmail,
  listPendingInvitationsForVenue,
  listVenueMembers,
  revokeInvitation,
  revokeMember,
  updateMemberRole,
  updateVenueType,
} from "../lib/memberships";
import {
  sendInvitationEmail,
  sendInvitationRevokedEmail,
} from "../lib/email";
import { db, venueInvitationsTable, venuesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { VENUE_TYPES } from "@workspace/db";

interface InviterIdentity {
  name: string;
  email: string;
}

async function lookupInviter(userId: string): Promise<InviterIdentity> {
  try {
    // First-party identity: resolve the inviter's verified email from their auth
    // account (userId is now a first-party account id, not a third-party IdP id).
    const email = (await getAuthService().getAccountEmail(userId)) ?? "";
    const name = email ? email.split("@")[0] : "";
    return { name, email };
  } catch {
    return { name: "", email: "" };
  }
}

const router: IRouter = Router();

const InviteBody = z.object({
  email: z.string().trim().min(3).max(254),
  role: z.enum(["handler", "supervisor", "owner"]).optional(),
});

const VenueSettingsBody = z.object({
  venueType: z.enum(VENUE_TYPES),
});

// ---------------------------------------------------------------------------
// Handler-facing endpoints (the invited user)
// ---------------------------------------------------------------------------

router.get("/me/invitations", requireAuth, async (req, res, next) => {
  try {
    const list = await listPendingInvitationsForEmail(req.userEmail ?? "");
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/me/invitations/:id/accept",
  requireAuth,
  async (req, res, next) => {
    try {
      const result = await acceptInvitation({
        invitationId: String(req.params.id),
        userId: req.userId!,
        userEmail: req.userEmail ?? "",
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(200).json({ venue: result.venue });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/me/invitations/:id/decline",
  requireAuth,
  async (req, res, next) => {
    try {
      const result = await declineInvitation({
        invitationId: String(req.params.id),
        userEmail: req.userEmail ?? "",
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Owner-facing endpoints (manage who can work the venue)
// ---------------------------------------------------------------------------

const ownerOnly = requireVenueRole(["owner", "supervisor"]);

router.get(
  "/venues/:venueCode/invitations",
  requireAuth,
  ownerOnly,
  async (req, res, next) => {
    try {
      const code = String(req.params.venueCode).toUpperCase();
      const list = await listPendingInvitationsForVenue(code);
      res.json(list);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/venues/:venueCode/invitations",
  requireAuth,
  ownerOnly,
  async (req, res, next) => {
    try {
      const code = String(req.params.venueCode).toUpperCase();
      const parsed = InviteBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }
      // Only existing owners can create new owners. Supervisors can invite
      // handlers and other supervisors but cannot grant owner-level access.
      const requestedRole = parsed.data.role ?? "handler";
      const actorRole =
        req.venues?.find((v) => v.code === code)?.role ?? "";
      if (requestedRole === "owner" && actorRole !== "owner") {
        res.status(403).json({
          error: "Only an owner can grant the owner role",
        });
        return;
      }
      const result = await createInvitation({
        venueCode: code,
        email: parsed.data.email,
        role: requestedRole,
        invitedByUserId: req.userId!,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      // Fire the invitation email after the DB write committed. We don't
      // await for the email to land before responding — the invite already
      // exists in the database and the recipient can be notified out of
      // band — but we do log failures.
      const inviter = await lookupInviter(req.userId!);
      void sendInvitationEmail({
        to: result.invitation.email,
        venueName: result.invitation.venueName,
        inviterName: inviter.name,
        inviterEmail: inviter.email,
        role: result.invitation.role,
      }).catch((err) =>
        logger.error({ err }, "sendInvitationEmail threw"),
      );
      res.status(201).json(result.invitation);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/venues/:venueCode/invitations/:id",
  requireAuth,
  ownerOnly,
  async (req, res, next) => {
    try {
      const code = String(req.params.venueCode).toUpperCase();
      // Snapshot the invite (and venue name) before revoking so we can email
      // the recipient even though the row's status will be flipped.
      const [snapshot] = await db
        .select({
          email: venueInvitationsTable.email,
          venueName: venuesTable.name,
        })
        .from(venueInvitationsTable)
        .innerJoin(
          venuesTable,
          eq(venuesTable.id, venueInvitationsTable.venueCode),
        )
        .where(
          and(
            eq(venueInvitationsTable.id, String(req.params.id)),
            eq(venueInvitationsTable.venueCode, code),
            eq(venueInvitationsTable.status, "pending"),
          ),
        )
        .limit(1);
      const result = await revokeInvitation({
        invitationId: String(req.params.id),
        venueCode: code,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      if (snapshot) {
        const inviter = await lookupInviter(req.userId!);
        void sendInvitationRevokedEmail({
          to: snapshot.email,
          venueName: snapshot.venueName,
          inviterName: inviter.name,
          inviterEmail: inviter.email,
        }).catch((err) =>
          logger.error({ err }, "sendInvitationRevokedEmail threw"),
        );
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// Re-send the email for an existing pending invitation. Useful when the
// original message was lost (spam folder, typo on first send, etc.) — the
// owner can trigger another delivery without revoking and recreating.
router.post(
  "/venues/:venueCode/invitations/:id/resend",
  requireAuth,
  ownerOnly,
  async (req, res, next) => {
    try {
      const code = String(req.params.venueCode).toUpperCase();
      const [invite] = await db
        .select({
          id: venueInvitationsTable.id,
          email: venueInvitationsTable.email,
          role: venueInvitationsTable.role,
          status: venueInvitationsTable.status,
          venueName: venuesTable.name,
        })
        .from(venueInvitationsTable)
        .innerJoin(
          venuesTable,
          eq(venuesTable.id, venueInvitationsTable.venueCode),
        )
        .where(
          and(
            eq(venueInvitationsTable.id, String(req.params.id)),
            eq(venueInvitationsTable.venueCode, code),
          ),
        )
        .limit(1);
      if (!invite) {
        res.status(404).json({ error: "Invitation not found" });
        return;
      }
      if (invite.status !== "pending") {
        res.status(410).json({
          error: "Invitation is no longer pending",
        });
        return;
      }
      const inviter = await lookupInviter(req.userId!);
      await sendInvitationEmail({
        to: invite.email,
        venueName: invite.venueName,
        inviterName: inviter.name,
        inviterEmail: inviter.email,
        role: invite.role,
        resend: true,
      });
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/venues/:venueCode/members",
  requireAuth,
  ownerOnly,
  async (req, res, next) => {
    try {
      const code = String(req.params.venueCode).toUpperCase();
      const members = await listVenueMembers(code);
      // Enrich with the member's first-party account email so the owner can
      // identify the person, not just an opaque account id.
      const auth = getAuthService();
      const enriched = await Promise.all(
        members.map(async (m) => {
          try {
            const email = (await auth.getAccountEmail(m.userId)) ?? "";
            const name = email ? email.split("@")[0] : m.userId;
            return { ...m, email, name };
          } catch {
            return { ...m, email: "", name: m.userId };
          }
        }),
      );
      res.json(enriched);
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/venues/:venueCode",
  requireAuth,
  ownerOnly,
  async (req, res, next) => {
    try {
      const code = String(req.params.venueCode).toUpperCase();
      const parsed = VenueSettingsBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
        return;
      }
      const result = await updateVenueType(code, parsed.data.venueType);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ venueCode: code, venueType: result.venueType });
    } catch (err) {
      next(err);
    }
  },
);

const MemberRoleBody = z.object({
  role: z.enum(["handler", "supervisor", "owner"]),
});

router.patch(
  "/venues/:venueCode/members/:userId",
  requireAuth,
  ownerOnly,
  async (req, res, next) => {
    try {
      const code = String(req.params.venueCode).toUpperCase();
      const parsed = MemberRoleBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
        return;
      }
      // Only existing owners can mint new owners. Mirrors the same guard on
      // the invitation-create path so supervisors can't promote past their
      // own role.
      const actorRole =
        req.venues?.find((v) => v.code === code)?.role ?? "";
      if (parsed.data.role === "owner" && actorRole !== "owner") {
        res.status(403).json({
          error: "Only an owner can grant the owner role",
        });
        return;
      }
      const result = await updateMemberRole({
        venueCode: code,
        targetUserId: String(req.params.userId),
        newRole: parsed.data.role,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({
        venueCode: code,
        userId: String(req.params.userId),
        role: result.role,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/venues/:venueCode/members/:userId",
  requireAuth,
  ownerOnly,
  async (req, res, next) => {
    try {
      const code = String(req.params.venueCode).toUpperCase();
      const result = await revokeMember({
        venueCode: code,
        targetUserId: String(req.params.userId),
        actingUserId: req.userId!,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
