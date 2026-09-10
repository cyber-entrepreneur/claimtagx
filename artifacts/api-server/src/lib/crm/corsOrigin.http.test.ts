import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import cors from "cors";
import { corsOriginDelegate, isCredentialedOriginAllowed } from "./corsOrigin.ts";
import { closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

async function listen(
  env: { NODE_ENV: string; CORS_ALLOWED_ORIGINS?: string },
): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(
    cors({
      credentials: true,
      origin: (origin, cb) => corsOriginDelegate(origin, cb, env),
    }),
  );
  app.use(express.json());
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  app.post("/platform-cookie", (req, res) => {
    const cookie = String(req.headers.cookie ?? "");
    if (cookie.includes("ctx_auth_session")) {
      if (!isCredentialedOriginAllowed(req.headers.origin, env)) {
        res.status(403).json({ error: "CSRF origin rejected" });
        return;
      }
    }
    res.json({ ok: true });
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

describe("credentialed CORS HTTP", () => {
  it("reflects loopback dynamic ports in development and rejects hostile origins", async () => {
    const env = { NODE_ENV: "development" };
    const { server, base } = await listen(env);
    try {
      const ok = await fetch(`${base}/ping`, {
        headers: { origin: "http://127.0.0.1:5174" },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("access-control-allow-origin"), "http://127.0.0.1:5174");
      assert.equal(ok.headers.get("access-control-allow-credentials"), "true");

      const evil = await fetch(`${base}/ping`, { headers: { origin: "https://evil.example" } });
      assert.notEqual(evil.headers.get("access-control-allow-origin"), "https://evil.example");

      const csrfOk = await fetch(`${base}/platform-cookie`, {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:5174",
          cookie: "ctx_auth_session=test",
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(csrfOk.status, 200);

      const csrfEvil = await fetch(`${base}/platform-cookie`, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          cookie: "ctx_auth_session=test",
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(csrfEvil.status, 403);
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });

  it("production reflects only configured origins, never loopback", async () => {
    const env = { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "https://app.claimtagx.com" };
    const { server, base } = await listen(env);
    try {
      const appOrigin = await fetch(`${base}/ping`, {
        headers: { origin: "https://app.claimtagx.com" },
      });
      assert.equal(appOrigin.status, 200);
      assert.equal(appOrigin.headers.get("access-control-allow-origin"), "https://app.claimtagx.com");

      const loop = await fetch(`${base}/ping`, { headers: { origin: "http://127.0.0.1:5174" } });
      assert.notEqual(loop.headers.get("access-control-allow-origin"), "http://127.0.0.1:5174");

      const csrfLoop = await fetch(`${base}/platform-cookie`, {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:5174",
          cookie: "ctx_auth_session=test",
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(csrfLoop.status, 403);
    } finally {
      await closeIsolatedHttpServer(server);
    }
  });
});
