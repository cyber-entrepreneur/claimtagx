import pino from "pino";
import { sanitizeLogRecord } from "./logSanitize";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  hooks: {
    logMethod(args, method) {
      const next = args.map((arg) => {
        if (arg && typeof arg === "object" && !Buffer.isBuffer(arg) && !(arg instanceof Error)) {
          return sanitizeLogRecord(arg as Record<string, unknown>);
        }
        if (typeof arg === "string") {
          return sanitizeLogRecord({ msg: arg }).msg;
        }
        return arg;
      });
      return method.apply(this, next as Parameters<typeof method>);
    },
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
