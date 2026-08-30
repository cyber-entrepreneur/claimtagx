import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

// Build an explicit allowlist of origins permitted to send credentialed
// requests. Reflecting arbitrary origins with `credentials: true` would let
// any site ride the user's Clerk session cookie, so we hard-fail anything
// not on this list. Localhost is allowed in development only.
function buildAllowedOrigins(): Set<string> {
  const list = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(",")) {
      const v = part.trim();
      if (!v) continue;
      list.add(v.startsWith("http") ? v : `https://${v}`);
    }
  };
  add(process.env.REPLIT_DEV_DOMAIN);
  add(process.env.REPLIT_DEPLOYMENT_DOMAIN);
  add(process.env.CORS_ALLOWED_ORIGINS);
  if (process.env.NODE_ENV !== "production") {
    list.add("http://localhost:5173");
    list.add("http://localhost:8080");
    list.add("http://127.0.0.1:5173");
    list.add("http://127.0.0.1:8080");
  }
  return list;
}

const allowedOrigins = buildAllowedOrigins();
const corsOptions: CorsOptions = {
  credentials: true,
  origin(origin, callback) {
    // Same-origin / non-browser requests have no Origin header.
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} is not allowed`));
  },
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

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));

app.use(clerkMiddleware());

app.use("/api", router);

export default app;
