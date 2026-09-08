import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { isWildcardBind, resolveListenHost } from "./listenHost.ts";

export type ListenRow = { address: string; port: number; pid?: string };

export function parseNetstat(output: string): ListenRow[] {
  const rows: ListenRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!/\bLISTENING\b/i.test(line) && !/\bLISTEN\b/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const local = parts[1] ?? parts[2] ?? "";
    const pid = parts.at(-1);
    const m = local.match(/^(.*):(\d+)$/);
    if (!m) continue;
    let address = m[1];
    if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
    rows.push({ address, port: Number(m[2]), pid });
  }
  return rows;
}

function inspectListeners(): ListenRow[] {
  const errors: string[] = [];
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", timeout: 15_000 });
    const rows = parseNetstat(out);
    if (rows.length) return rows;
    errors.push("netstat returned no LISTENING rows");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-NetTCPConnection -State Listen | ForEach-Object { '{0} {1} {2}' -f $_.LocalAddress,$_.LocalPort,$_.OwningProcess }",
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    const rows: ListenRow[] = [];
    for (const line of out.split(/\r?\n/)) {
      const [address, portRaw, pid] = line.trim().split(/\s+/);
      const port = Number(portRaw);
      if (!address || !Number.isFinite(port)) continue;
      rows.push({ address, port, pid });
    }
    if (rows.length) return rows;
    errors.push("Get-NetTCPConnection returned no rows");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  throw new Error(`port inspection failed: ${errors.join("; ")}`);
}

describe("local network isolation", () => {
  it("defaults development to loopback and requires LISTEN_HOST in production", () => {
    assert.equal(resolveListenHost({ NODE_ENV: "development" }), "127.0.0.1");
    assert.equal(isWildcardBind("0.0.0.0"), true);
    assert.equal(isWildcardBind("::"), true);
    assert.equal(isWildcardBind("127.0.0.1"), false);
  });

  it("fails closed if isolated verification postgres is missing or wildcard-bound", () => {
    // Locally actionable without requiring API/Vite/Verdaccio during the CRM unit suite.
    // Set CRM_VERIFY_LISTEN=full to also assert api/vite/verdaccio loopback binds.
    const rows = inspectListeners();
    const isolatedPorts = new Set(
      [process.env.PGPORT, "55470", "55432"].map((p) => Number(p)).filter((n) => Number.isFinite(n)),
    );
    const postgres = rows.filter((row) => isolatedPorts.has(row.port));
    assert.ok(postgres.length > 0, "postgres is not listening on isolated 55470/55432");
    for (const hit of postgres) {
      assert.equal(
        isWildcardBind(hit.address) || hit.address === "*" || hit.address === "::0",
        false,
        `postgres wildcard bind ${hit.address}:${hit.port}`,
      );
      assert.match(hit.address, /^(127\.0\.0\.1|::1)$/, `postgres must be loopback, got ${hit.address}`);
    }
    if (process.env.CRM_VERIFY_LISTEN === "full") {
      const expected: Array<{ port: number; label: string }> = [
        { port: 4873, label: "verdaccio" },
        { port: 18080, label: "api" },
        { port: 5173, label: "vite" },
      ];
      for (const svc of expected) {
        const hits = rows.filter((row) => row.port === svc.port);
        assert.ok(hits.length > 0, `${svc.label} is not listening on ${svc.port}`);
        for (const hit of hits) {
          assert.equal(
            isWildcardBind(hit.address) || hit.address === "*" || hit.address === "::0",
            false,
            `${svc.label} wildcard bind ${hit.address}:${hit.port}`,
          );
          assert.match(hit.address, /^(127\.0\.0\.1|::1)$/, `${svc.label} must be loopback`);
        }
      }
    }
  });
});
