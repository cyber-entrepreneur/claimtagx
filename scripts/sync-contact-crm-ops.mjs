#!/usr/bin/env node
/** Parse openapi-contact-crm.yaml into CONTACT_CRM_OPERATIONS. Optional --write. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const yamlPath = join(root, "lib/api-spec/openapi-contact-crm.yaml");
const outPath = join(root, "lib/api-client-react/src/contact-crm.ts");

function parseContactCrmOperations(yaml) {
  const ops = [];
  let path = "";
  let method = "";
  for (const line of yaml.split(/\n/)) {
    const p = line.match(/^  (\/\S+):/);
    if (p) path = p[1];
    const m = line.match(/^    (get|post|put|patch|delete):/);
    if (m) method = m[1].toUpperCase();
    const o = line.match(/operationId:\s+(\S+)/);
    if (o && path && method) ops.push({ id: o[1], method, path });
  }
  return ops;
}

const yaml = readFileSync(yamlPath, "utf8");
const ops = parseContactCrmOperations(yaml);
if (process.argv.includes("--write")) {
  const lines = [
    "/**",
    " * OpenAPI operation metadata generated from lib/api-spec/openapi-contact-crm.yaml",
    " * by scripts/sync-contact-crm-ops.mjs. This is not a request/response contract.",
    " * Types and fetch operations live in ./contact-generated (Orval).",
    " */",
    "export const CONTACT_CRM_OPERATIONS = {",
    ...ops.map((op) => `  ${op.id}: { method: "${op.method}", path: "${op.path}" },`),
    "} as const;",
    "",
    "export type ContactCrmOperationId = keyof typeof CONTACT_CRM_OPERATIONS;",
    "",
    "export function contactCrmPath(",
    "  id: ContactCrmOperationId,",
    "  params?: Record<string, string>,",
    "): string {",
    "  let path: string = CONTACT_CRM_OPERATIONS[id].path;",
    "  for (const [key, value] of Object.entries(params ?? {})) {",
    "    path = path.replace(`{${key}}`, encodeURIComponent(value));",
    "  }",
    "  return path;",
    "}",
    "",
  ];
  writeFileSync(outPath, lines.join("\n"));
  console.log(`wrote ${ops.length} operations to ${outPath}`);
} else {
  for (const op of ops) console.log(`${op.method} ${op.path} ${op.id}`);
  console.error(`count ${ops.length}`);
}
