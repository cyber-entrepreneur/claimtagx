import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CONTACT_CRM_OPERATIONS } from "../../../../../lib/api-client-react/src/contact-crm.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..", "..");
const routesDir = join(here, "..", "..", "routes");
const specPath = join(root, "lib", "api-spec", "openapi-contact-crm.yaml");

const ROUTE_FILES = [
  "contact.ts",
  "platformAuth.ts",
  "platformContact.ts",
  "platformChannels.ts",
  "platformGovernance.ts",
  "platformConfigChanges.ts",
  "platformEffects.ts",
  "platformMarketing.ts",
  "platformHealth.ts",
] as const;

/**
 * Live Express handlers that are intentionally absent from OpenAPI
 * (test/dev internals).
 */
const ROUTER_OMISSIONS = new Set([
  "POST /platform/auth/test-login",
]);

/**
 * OpenAPI operations that are documented but not yet wired on the router
 * (x-status: planned or other intentional gaps).
 */
const OPENAPI_PLANNED_WITHOUT_ROUTER = new Set<string>();

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RouteEntry = { method: HttpMethod; path: string; file: string };
type OpenApiOp = {
  id: string;
  method: HttpMethod;
  path: string;
  status: "implemented" | "planned" | string;
};

function expressPathToOpenApi(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${expressPathToOpenApi(path)}`;
}

function extractRouterRoutes(): RouteEntry[] {
  const out: RouteEntry[] = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  for (const file of ROUTE_FILES) {
    const src = readFileSync(join(routesDir, file), "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const path = m[2];
      if (!path.startsWith("/contact") && !path.startsWith("/platform") && path !== "/livez" && path !== "/readyz") {
        continue;
      }
      out.push({
        method: m[1].toUpperCase() as HttpMethod,
        path,
        file,
      });
    }
  }
  return out;
}

function extractOpenApiOps(spec: string): OpenApiOp[] {
  const ops: OpenApiOp[] = [];
  const pathBlocks = spec.split(/\n  \//).slice(1);
  for (const block of pathBlocks) {
    const pathLine = block.split("\n")[0] ?? "";
    const path = `/${pathLine.replace(/:\s*$/, "").trim()}`;
    const sections = block.split(/(?=^\s{4}(?:get|post|put|patch|delete):\s*$)/m);
    for (const sec of sections) {
      const meth = sec.match(/^\s{4}(get|post|put|patch|delete):\s*$/m);
      if (!meth) continue;
      const opId = sec.match(/operationId:\s+(\S+)/);
      if (!opId) continue;
      const status = sec.match(/x-status:\s+(\S+)/)?.[1] ?? "unknown";
      ops.push({
        id: opId[1],
        method: meth[1].toUpperCase() as HttpMethod,
        path,
        status,
      });
    }
  }
  return ops;
}

describe("Contact CRM router ↔ OpenAPI ↔ catalog drift", () => {
  const routes = extractRouterRoutes();
  const spec = readFileSync(specPath, "utf8");
  const ops = extractOpenApiOps(spec);
  const opByKey = new Map(ops.map((o) => [routeKey(o.method, o.path), o]));
  const routeByKey = new Map(routes.map((r) => [routeKey(r.method, r.path), r]));

  it("discovers CRM platform/contact routes from Express sources", () => {
    assert.ok(routes.length >= 100, `expected many CRM routes, got ${routes.length}`);
    assert.ok(ops.length >= 100, `expected many OpenAPI ops, got ${ops.length}`);
  });

  it("fails when a live CRM route has no OpenAPI operation (except allowlisted internals)", () => {
    const missing: string[] = [];
    for (const r of routes) {
      const key = routeKey(r.method, r.path);
      if (ROUTER_OMISSIONS.has(key)) continue;
      if (!opByKey.has(key)) missing.push(`${key} (${r.file})`);
    }
    assert.deepEqual(missing, [], `router→OpenAPI gaps:\n${missing.join("\n")}`);
  });

  it("fails when an OpenAPI x-status:implemented op has no matching router handler", () => {
    const missing: string[] = [];
    for (const o of ops) {
      if (o.status !== "implemented") continue;
      if (OPENAPI_PLANNED_WITHOUT_ROUTER.has(o.id)) continue;
      const key = routeKey(o.method, o.path);
      if (!routeByKey.has(key)) missing.push(`${key} (${o.id})`);
    }
    assert.deepEqual(missing, [], `OpenAPI→router gaps:\n${missing.join("\n")}`);
  });

  it("keeps documented planned-only / intentional gaps stable", () => {
    for (const id of OPENAPI_PLANNED_WITHOUT_ROUTER) {
      const op = ops.find((o) => o.id === id);
      assert.ok(op, `exception ${id} must still exist in OpenAPI`);
      assert.notEqual(op.status, "implemented", `${id} is listed as planned-only but marked implemented`);
      const key = routeKey(op.method, op.path);
      assert.equal(routeByKey.has(key), false, `${id} gained a router handler — remove from OPENAPI_PLANNED_WITHOUT_ROUTER`);
    }
    for (const key of ROUTER_OMISSIONS) {
      assert.ok(routeByKey.has(key), `omission ${key} must still exist on the router`);
      assert.equal(opByKey.has(key), false, `omission ${key} appeared in OpenAPI — remove from ROUTER_OMISSIONS`);
    }
  });

  it("keeps CONTACT_CRM_OPERATIONS catalog aligned with OpenAPI method/path/id", () => {
    const catalogIds = new Set(Object.keys(CONTACT_CRM_OPERATIONS));
    const opIds = new Set(ops.map((o) => o.id));

    const catalogOnly = [...catalogIds].filter((id) => !opIds.has(id));
    const openApiOnly = [...opIds].filter((id) => !catalogIds.has(id));
    assert.deepEqual(catalogOnly, [], `catalog→OpenAPI id gaps: ${catalogOnly.join(", ")}`);
    assert.deepEqual(openApiOnly, [], `OpenAPI→catalog id gaps: ${openApiOnly.join(", ")}`);

    for (const [id, meta] of Object.entries(CONTACT_CRM_OPERATIONS)) {
      const op = ops.find((o) => o.id === id);
      assert.ok(op, id);
      assert.equal(op.method, meta.method, id);
      assert.equal(op.path, meta.path, id);
    }
  });
});
