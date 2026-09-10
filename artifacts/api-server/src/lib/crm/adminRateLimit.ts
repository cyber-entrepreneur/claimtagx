import type { NextFunction, Request, Response } from "express";
import { rateLimitOk } from "./rateLimit";

function clientIp(req: Request): string {
  const xf = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return xf || req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Postgres-backed admin API rate limit. Safe across API replicas.
 * Override with CRM_ADMIN_RATE_MAX / CRM_ADMIN_RATE_WINDOW_MS.
 */
export async function requireAdminRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const max = Number(process.env.CRM_ADMIN_RATE_MAX ?? "120");
    const windowMs = Number(process.env.CRM_ADMIN_RATE_WINDOW_MS ?? String(60_000));
    const staffId = req.platformStaff?.id ?? "anon";
    const key = `admin:${staffId}:${clientIp(req)}:${req.method}:${req.baseUrl}`;
    const ok = await rateLimitOk(
      key,
      Number.isFinite(max) ? max : 120,
      Number.isFinite(windowMs) ? windowMs : 60_000,
    );
    if (!ok) {
      res.status(429).json({ error: "Too many admin requests. Please slow down." });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
