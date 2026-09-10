import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  corsOriginDelegate,
  isCredentialedOriginAllowed,
} from "./lib/crm/corsOrigin";
import { AUTH_SESSION_COOKIE } from "./lib/auth/composeAuthPlatform";

const app: Express = express();

const corsOptions: CorsOptions = {
  credentials: true,
  origin: corsOriginDelegate,
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  next();
});

app.use(cors(corsOptions));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.method === "POST" && req.path.includes("/webhooks/")) {
    const len = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(len) && len > 64 * 1024) {
      res.status(413).json({ error: "payload_too_large", live: false });
      return;
    }
  }
  next();
});
app.use(
  express.json({
    limit: "256kb",
    verify(req, _res, buf) {
      if (req.url?.includes("/webhooks/") && buf.length > 64 * 1024) {
        throw Object.assign(new Error("payload_too_large"), { status: 413 });
      }
      (req as { rawBody?: string; rawBodyBytes?: Buffer }).rawBodyBytes = Buffer.from(buf);
      (req as { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "");
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
} else {
  app.set("trust proxy", false);
}

// Pre-session (public) first-party auth endpoints: these establish or reset an
// identity and legitimately arrive without an existing session cookie, so they
// are exempt from the cookie-CSRF origin check below. Authenticated auth
// endpoints (logout, logout-all, change-password, mfa/enroll, mfa/confirm,
// mfa/recovery-codes, sessions) are NOT exempt — they carry the session cookie and
// must pass the origin check.
const CSRF_EXEMPT_AUTH_PATHS = new Set([
  "/api/platform/auth/login",
  "/api/platform/auth/mfa/challenge",
  "/api/platform/auth/forgot-password",
  "/api/platform/auth/reset-password",
  "/api/platform/auth/verify-email",
  "/api/platform/auth/invite/accept",
  "/api/platform/auth/bootstrap",
  "/api/platform/auth/test-login",
]);

app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  if (!req.path.startsWith("/api/platform")) {
    next();
    return;
  }
  if (CSRF_EXEMPT_AUTH_PATHS.has(req.path)) {
    next();
    return;
  }
  const cookie = req.headers.cookie ?? "";
  const hasSessionCookie = cookie.includes(AUTH_SESSION_COOKIE);
  if (typeof req.headers.authorization === "string") {
    // Bearer-only requests may skip cookie CSRF; cookie sessions must still pass origin checks.
    if (!hasSessionCookie) {
      next();
      return;
    }
  }
  const origin = req.headers.origin;
  if (hasSessionCookie) {
    if (!isCredentialedOriginAllowed(origin)) {
      res.status(403).json({ error: "CSRF origin rejected" });
      return;
    }
  }
  next();
});

app.use("/api", router);

export default app;
