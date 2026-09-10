import type { Server } from "node:http";

/**
 * Isolated CRM databases listen on loopback 55432 (documented) or 55470
 * (Windows excluded-port workaround). Names must be claimtagx_crm_* or
 * ctx_e2e_<hex> — never a shared operator database.
 */
export function isIsolatedCrmDatabaseUrl(url: string): boolean {
  return /127\.0\.0\.1:(55432|55470)/.test(url);
}

export function assertIsolatedCrmDatabase(purpose: string, url = process.env.DATABASE_URL ?? ""): void {
  if (!isIsolatedCrmDatabaseUrl(url)) {
    throw new Error(`${purpose} require isolated DATABASE_URL on 127.0.0.1:55432 or 127.0.0.1:55470`);
  }
  const name = url.replace(/^[a-z]+:\/\/[^/]+\//i, "").split("?")[0] ?? "";
  const ok = /^claimtagx_crm_[a-z0-9_]+$/.test(name) || /^ctx_e2e_[a-f0-9]{8}$/.test(name);
  if (!ok) {
    throw new Error(`${purpose} refuse non-isolated database name`);
  }
}

export function isolatedRestoreDatabaseUrl(): string | null {
  const restore = process.env.DATABASE_URL_RESTORE ?? "";
  const fallback = process.env.DATABASE_URL ?? "";
  for (const url of [restore, fallback]) {
    if (!isIsolatedCrmDatabaseUrl(url)) continue;
    if (/claimtagx_crm_[a-z0-9_]*restore/.test(url) || url.includes("claimtagx_crm_verify_restore")) {
      return url;
    }
  }
  return null;
}

/** Drop keep-alive so node:test does not hang after HTTP suites. */
export async function closeIsolatedHttpServer(server: Server): Promise<void> {
  const idle = server as Server & { closeIdleConnections?: () => void };
  try {
    idle.closeIdleConnections?.();
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
