import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  corsOriginDelegate,
  isCredentialedOriginAllowed,
} from "./lib/crm/corsOrigin";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

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

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

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

app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  if (!req.path.startsWith("/api/platform")) {
    next();
    return;
  }
  if (req.path === "/api/platform/auth/login") {
    next();
    return;
  }
  if (typeof req.headers.authorization === "string") {
    const cookie = req.headers.cookie ?? "";
    // Bearer-only requests may skip cookie CSRF; cookie sessions must still pass origin checks.
    if (!cookie.includes("ctx_platform_session")) {
      next();
      return;
    }
  }
  const origin = req.headers.origin;
  const cookie = req.headers.cookie ?? "";
  if (cookie.includes("ctx_platform_session")) {
    if (!isCredentialedOriginAllowed(origin)) {
      res.status(403).json({ error: "CSRF origin rejected" });
      return;
    }
  }
  next();
});

if (process.env.CLERK_PUBLISHABLE_KEY) {
  app.use(clerkMiddleware());
} else if (process.env.NODE_ENV === "production") {
  throw new Error("CLERK_PUBLISHABLE_KEY is required in production");
} else {
  logger.warn("Clerk middleware disabled (no CLERK_PUBLISHABLE_KEY); development only");
}

app.use("/api", router);

export default app;
