import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "artifacts", "claimtagx", "content", "marketing", "manifest.json");
const requiredPublished = ["home.hero", "contact.hero"];

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const missing = requiredPublished.filter((id) => {
  const page = manifest.pages.find((entry) => entry.id === id);
  return !page || page.status !== "published";
});

if (missing.length) {
  console.error(`Marketing CMS gate failed. Unpublished required pages: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Marketing CMS gate passed.");
