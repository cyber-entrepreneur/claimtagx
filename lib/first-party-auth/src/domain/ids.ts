import type { Id } from "../shared/ids.js";

export type AccountId = Id<"AccountId">;
export type CredentialId = Id<"CredentialId">;
export type SessionId = Id<"SessionId">;
export type ChallengeId = Id<"ChallengeId">;
/** A signed-in endpoint (phone, browser, radio unit). Bound to sessions. */
export type DeviceId = Id<"DeviceId">;
