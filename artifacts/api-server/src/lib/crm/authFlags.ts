import { assertBotAdapterProduction } from "./botAdapter";

/**
 * Production must never honor a shared access key, even if an operator
 * mistakenly sets PLATFORM_ALLOW_ACCESS_KEY_LOGIN=true.
 */
export function isLegacyAccessKeyLoginAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  if (env.CRM_FORCE_DISABLE_ACCESS_KEY === "true") return false;
  return env.PLATFORM_ALLOW_ACCESS_KEY_LOGIN === "true";
}

export function isCrmHttpTestAuthAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  return env.CRM_HTTP_TEST_AUTH === "true";
}

/** Fail closed before listen when production env is insecure. */
export function assertProductionSecurity(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const forbiddenTrue = [
    "CRM_HTTP_TEST_AUTH",
    "CRM_ALLOW_TEST_JOBS",
    "CRM_EMAIL_SIMULATOR",
    "CRM_GRAPH_SIMULATOR",
    "CRM_CHANNEL_SIMULATOR",
    "CRM_EMBED_WORKER",
  ] as const;
  for (const key of forbiddenTrue) {
    if (env[key] === "true") {
      throw new Error(`${key} is forbidden in production`);
    }
  }
  if (!env.PLATFORM_STAFF_SESSION_SECRET?.trim()) {
    throw new Error("PLATFORM_STAFF_SESSION_SECRET is required in production");
  }
  if (!env.CRM_ATTACHMENT_SIGNING_SECRET?.trim() || env.CRM_ATTACHMENT_SIGNING_SECRET === "local-verify-only") {
    throw new Error("CRM_ATTACHMENT_SIGNING_SECRET must be a non-default value in production");
  }
  if (env.MS_GRAPH_ALLOWED_HOSTS?.trim()) {
    throw new Error("MS_GRAPH_ALLOWED_HOSTS must be empty in production");
  }
  assertBotAdapterProduction(env);
}

