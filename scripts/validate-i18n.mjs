import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, "..", "artifacts", "claimtagx", "src", "lib", "i18n", "locales");

function flattenKeys(node, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(node)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) keys.push(...flattenKeys(value, next));
    else keys.push(next);
  }
  return keys;
}

function loadLocaleExport(file) {
  const raw = readFileSync(file, "utf8");
  const match = raw.match(/export const \w+: TranslationTree = (\{[\s\S]*\});?\s*$/m);
  if (!match) throw new Error(`Could not parse ${file}`);
  return Function(`"use strict"; return (${match[1]});`)();
}

/** Load en.ts / ar.ts after substituting imported TranslationTree bindings. */
function loadMainLocale(file, bindings) {
  let raw = readFileSync(file, "utf8");
  raw = raw.replace(/^import[\s\S]*?;\r?\n/gm, "");
  const match = raw.match(/export const \w+: TranslationTree = (\{[\s\S]*\});?\s*$/m);
  if (!match) throw new Error(`Could not parse ${file}`);
  let src = match[1];
  const argNames = [];
  const argValues = [];
  let i = 0;
  for (const [name, tree] of Object.entries(bindings)) {
    const placeholder = `__BIND_${i}__`;
    src = src.replace(new RegExp(`\\b${name}\\b`, "g"), placeholder);
    argNames.push(placeholder);
    argValues.push(tree);
    i += 1;
  }
  return Function(...argNames, `"use strict"; return (${src});`)(...argValues);
}

const homeEn = loadLocaleExport(join(localesDir, "home.en.ts"));
const homeAr = loadLocaleExport(join(localesDir, "home.ar.ts"));
const solutionsEn = loadLocaleExport(join(localesDir, "solutions.en.ts"));
const solutionsAr = loadLocaleExport(join(localesDir, "solutions.ar.ts"));
const enTree = loadMainLocale(join(localesDir, "en.ts"), { homeEn, solutionsEn });
const arTree = loadMainLocale(join(localesDir, "ar.ts"), { homeAr, solutionsAr });
const enKeys = new Set(flattenKeys(enTree));
const arKeys = new Set(flattenKeys(arTree));

const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));
const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));

if (missingInAr.length || missingInEn.length) {
  if (missingInAr.length) console.error("Missing Arabic keys:", missingInAr.join(", "));
  if (missingInEn.length) console.error("Extra Arabic keys:", missingInEn.join(", "));
  process.exit(1);
}
console.log(`i18n parity OK (${enKeys.size} keys).`);
