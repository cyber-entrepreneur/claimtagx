#!/usr/bin/env node
/**
 * Repo-scoped package-manager guard. Prefer this over a POSIX `sh -c` preinstall
 * so Windows and Unix workspaces can install cleanly without global config changes.
 */
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

for (const lock of ["package-lock.json", "yarn.lock"]) {
  const path = join(process.cwd(), lock);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // best-effort cleanup only
    }
  }
}

const ua = process.env.npm_config_user_agent ?? "";
if (!ua.includes("pnpm/")) {
  console.error("Use pnpm instead of npm/yarn for this workspace.");
  process.exit(1);
}
