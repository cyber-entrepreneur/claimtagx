import { createHash } from "node:crypto";
import { logger } from "./logger";
import {
  createMicrosoftGraphEmailProvider,
  getEmailProvider,
  type ThreadingEmailHeaders,
} from "./crm/emailProvider";

// ---------------------------------------------------------------------------
// Transactional email service (Microsoft Graph / Exchange Online).
//
// Sends via Microsoft Graph sendMail when MS_GRAPH_* configuration is present.
// Local verification uses CRM_GRAPH_SIMULATOR / CRM_EMAIL_SIMULATOR / CRM_ALLOW_TEST_JOBS.
// Production without Graph configuration hard-fails so CRM jobs can retry.
// ---------------------------------------------------------------------------

function getHandlerAppBaseUrl(): string {
  const explicit = process.env.HANDLER_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "") + "/";
  const deployed = process.env.REPLIT_DEPLOYMENT_DOMAIN?.trim();
  if (deployed) return `https://${deployed}/handler/`;
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev}/handler/`;
  return "/handler/";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: ThreadingEmailHeaders;
}

/** Sends mail and returns the provider message id, or null when skipped in non-production. */
export async function sendTransactionalEmail(
  args: SendArgs,
  opts?: { idempotencyKey?: string },
): Promise<string | null> {
  return send(args, opts);
}

export const testEmailLedger = new Map<string, { sends: number; providerMessageId: string }>();

async function send(args: SendArgs, opts?: { idempotencyKey?: string }): Promise<string | null> {
  const provider = getEmailProvider();
  try {
    const { providerMessageId } = await provider.send({
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      headers: args.headers,
      idempotencyKey: opts?.idempotencyKey,
    });
    if (process.env.CRM_ALLOW_TEST_JOBS === "true" && opts?.idempotencyKey && providerMessageId) {
      const key = opts.idempotencyKey;
      const existing = testEmailLedger.get(key);
      if (existing) {
        existing.sends += 1;
      } else {
        testEmailLedger.set(key, { sends: 1, providerMessageId });
      }
    }
    if (providerMessageId) {
      logger.info(
        {
          recipientDomain: args.to.split("@")[1],
          subject: args.subject,
          providerId: providerMessageId,
        },
        "transactional email accepted by Microsoft Graph",
      );
    }
    return providerMessageId;
  } catch (err) {
    if (
      process.env.NODE_ENV !== "production" &&
      !process.env.MS_GRAPH_TENANT_ID &&
      process.env.CRM_ALLOW_TEST_JOBS === "true"
    ) {
      const key = opts?.idempotencyKey ?? `no-key:${args.to}:${args.subject}`;
      const existing = testEmailLedger.get(key);
      if (existing) {
        existing.sends += 1;
        return existing.providerMessageId;
      }
      const providerMessageId = `test_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
      testEmailLedger.set(key, { sends: 1, providerMessageId });
      return providerMessageId;
    }
    throw err;
  }
}

export interface InvitationEmailParams {
  to: string;
  venueName: string;
  inviterName: string;
  inviterEmail: string;
  role: string;
  resend?: boolean;
}

export async function sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
  const link = getHandlerAppBaseUrl();
  const safeVenue = escapeHtml(params.venueName);
  const safeInviter = escapeHtml(params.inviterName || params.inviterEmail || "A venue owner");
  const safeRole = escapeHtml(params.role || "handler");
  const safeLink = escapeHtml(link);
  const greeting = params.resend
    ? `Reminder: you have a pending invitation to ${safeVenue}`
    : `You've been invited to ${safeVenue}`;
  const subject = params.resend
    ? `Reminder: invitation to ${params.venueName} on ClaimTagX`
    : `You're invited to ${params.venueName} on ClaimTagX`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0b1220">
      <h1 style="font-size:20px;margin:0 0 16px">${greeting}</h1>
      <p style="font-size:14px;line-height:1.5;margin:0 0 12px">
        <strong>${safeInviter}</strong> invited you to join <strong>${safeVenue}</strong>
        as a <strong>${safeRole}</strong> on ClaimTagX.
      </p>
      <p style="margin:24px 0">
        <a href="${safeLink}" style="background:#65d300;color:#0b1220;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;display:inline-block">
          Open ClaimTagX to accept or decline
        </a>
      </p>
      <p style="font-size:12px;color:#475569;line-height:1.5;margin:0">
        Sign in with this email address (${escapeHtml(params.to)}) to see the invitation in your inbox.
        If you weren't expecting this, you can safely ignore the message.
      </p>
    </div>
  `;
  const text = [
    `${greeting}.`,
    "",
    `${params.inviterName || params.inviterEmail || "A venue owner"} invited you to join ${params.venueName} as a ${params.role || "handler"} on ClaimTagX.`,
    "",
    `Open ClaimTagX to accept or decline: ${link}`,
    "",
    `Sign in with ${params.to} to see the invitation in your inbox.`,
    "If you weren't expecting this, you can safely ignore the message.",
  ].join("\n");

  await send({ to: params.to, subject, html, text });
}

export interface TamperSpikeEmailParams {
  to: string;
  venueName: string;
  venueCode: string;
  ticketId: string;
  attempts: number;
  windowMinutes: number;
  link: string;
}

export async function sendTamperSpikeEmail(params: TamperSpikeEmailParams): Promise<void> {
  const safeVenue = escapeHtml(params.venueName);
  const safeCode = escapeHtml(params.venueCode);
  const safeTicket = escapeHtml(params.ticketId);
  const safeLink = escapeHtml(params.link);
  const subject = `Tamper attempts spiking on ${params.venueName} (${params.ticketId})`;
  const headline = `${params.attempts} tamper attempts on ${params.ticketId} in the last ${params.windowMinutes} min`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b1220">
      <h1 style="font-size:20px;margin:0 0 12px;color:#b00020">Tamper attempts spiking</h1>
      <p style="font-size:14px;line-height:1.5;margin:0 0 12px">
        We just saw <strong>${params.attempts}</strong> failed tag-signature checks for ticket
        <strong>${safeTicket}</strong> at <strong>${safeVenue}</strong> (${safeCode})
        in the last ${params.windowMinutes} minute${params.windowMinutes === 1 ? "" : "s"}.
        That looks like an active fraud attempt &mdash; please take a look.
      </p>
      <p style="margin:24px 0">
        <a href="${safeLink}" style="background:#b00020;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;display:inline-block">
          Open the tamper feed
        </a>
      </p>
      <p style="font-size:12px;color:#475569;line-height:1.5;margin:0">
        You're receiving this because you're an owner of ${safeVenue}. We won't send
        another alert for this ticket until things calm down.
      </p>
    </div>
  `;
  const text = [
    `Tamper attempts spiking on ${params.venueName} (${params.venueCode}).`,
    "",
    headline + ".",
    "That looks like an active fraud attempt — please take a look.",
    "",
    `Open the tamper feed: ${params.link}`,
    "",
    `You're receiving this because you're an owner of ${params.venueName}.`,
    "We won't send another alert for this ticket until things calm down.",
  ].join("\n");
  await send({ to: params.to, subject, html, text });
}

export interface RevocationEmailParams {
  to: string;
  venueName: string;
  inviterName: string;
  inviterEmail: string;
}

export async function sendInvitationRevokedEmail(params: RevocationEmailParams): Promise<void> {
  const safeVenue = escapeHtml(params.venueName);
  const safeInviter = escapeHtml(params.inviterName || params.inviterEmail || "The venue owner");
  const subject = `Your invitation to ${params.venueName} was withdrawn`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0b1220">
      <h1 style="font-size:20px;margin:0 0 16px">Invitation withdrawn</h1>
      <p style="font-size:14px;line-height:1.5;margin:0 0 12px">
        ${safeInviter} has withdrawn your pending invitation to <strong>${safeVenue}</strong> on ClaimTagX.
        No action is needed on your part.
      </p>
      <p style="font-size:12px;color:#475569;line-height:1.5;margin:0">
        If you believe this was a mistake, contact ${safeInviter} directly.
      </p>
    </div>
  `;
  const text = [
    `Invitation withdrawn.`,
    "",
    `${params.inviterName || params.inviterEmail || "The venue owner"} has withdrawn your pending invitation to ${params.venueName} on ClaimTagX. No action is needed on your part.`,
    "",
    `If you believe this was a mistake, contact ${params.inviterName || params.inviterEmail || "the venue owner"} directly.`,
  ].join("\n");
  await send({ to: params.to, subject, html, text });
}

export { createMicrosoftGraphEmailProvider };
