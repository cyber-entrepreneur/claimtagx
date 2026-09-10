import type { CredentialKind } from "./credential.js";

/**
 * MFA glue. The available second factors map to credential kinds; the login
 * flow decides whether a step-up is required and, if so, which methods the
 * account can satisfy it with.
 */

export type MfaMethod = "totp" | "sms" | "recovery";

/** The subset of credential kinds that can serve as a second factor. */
export const mfaMethodToCredential: Record<MfaMethod, CredentialKind> = {
  totp: "totp",
  sms: "password", // sms step-up uses a verification challenge, not a stored credential
  recovery: "recovery",
};

/** Result of the first factor when a second is still owed. */
export interface MfaRequirement {
  readonly methods: readonly MfaMethod[];
}
