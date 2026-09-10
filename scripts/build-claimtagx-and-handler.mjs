import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const claimtagxDir = path.join(repoRoot, "artifacts", "claimtagx");
const claimtagxDistDir = path.join(claimtagxDir, "dist", "public");
const handlerDistDir = path.join(repoRoot, "artifacts", "handler-app", "dist", "public");
const handlerTargetDir = path.join(claimtagxDistDir, "handler");
const redirectsPath = path.join(claimtagxDistDir, "_redirects");

function run(cmd, args, options = {}) {
  // On Windows the command runs through cmd.exe, so paths with spaces
  // (e.g. C:\Program Files\nodejs\node.exe) must be quoted.
  const useShell = process.platform === "win32";
  const quote = (s) => (useShell && /\s/.test(s) ? `"${s}"` : s);
  const result = spawnSync(quote(cmd), args.map(quote), {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    shell: useShell,
    windowsVerbatimArguments: useShell,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const npmExecPath = process.env.npm_execpath;

if (!npmExecPath) {
  console.error("npm_execpath is not set. This script must be run via pnpm scripts.");
  process.exit(1);
}

console.log("==> Validating marketing CMS manifest...");
run(process.execPath, ["scripts/validate-marketing-content.mjs"]);

console.log("==> Generating sitemap...");
run(process.execPath, ["scripts/generate-sitemap.mjs"]);

console.log("==> Building marketing site...");
run(process.execPath, [npmExecPath, "exec", "vite", "build", "--config", "artifacts/claimtagx/vite.config.ts"]);

console.log("==> Prerendering public HTML metadata shells...");
run(process.execPath, ["scripts/prerender-public-html.mjs"]);

console.log("==> Validating SEO HTML output...");
run(process.execPath, ["scripts/validate-seo-html.mjs"]);

console.log("==> Validating i18n key parity...");
run(process.execPath, ["scripts/validate-i18n.mjs"]);

console.log("==> Validating public copy gate...");
run(process.execPath, ["scripts/validate-public-copy.mjs"]);

console.log("==> Building handler app (BASE_PATH=/handler/)...");
run(process.execPath, [npmExecPath, "--filter", "@workspace/handler-app", "run", "build"], {
  env: {
    ...process.env,
    BASE_PATH: "/handler/",
  },
});

console.log("==> Copying handler output into marketing dist...");
mkdirSync(handlerTargetDir, { recursive: true });
cpSync(handlerDistDir, handlerTargetDir, { recursive: true });

console.log("==> Writing Cloudflare SPA rewrites...");
writeFileSync(
  redirectsPath,
  [
    "/handler /handler/ 301",
    "/handler/* /handler/index.html 200",
    "/* /index.html 200",
    "",
  ].join("\n"),
  "utf8",
);

console.log("==> Done. Output available at artifacts/claimtagx/dist/public");
