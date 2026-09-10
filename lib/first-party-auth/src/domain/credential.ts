import type { EpochMillis } from "../shared/clock.js";
import type { AccountId, CredentialId } from "./ids.js";

/**
 * A credential is the stored proof-of-identity material, modelled as a
 * discriminated union on `kind`. CRITICAL: the core never holds a raw secret —
 * only opaque references produced by an adapter:
 *   - password  → `hashRef` (an argon2/bcrypt hash string; hashing is a port)
 *   - totp      → `secretRef` (an opaque handle to the shared secret; the raw
 *                  secret lives behind the TotpAuthenticator/secret store)
 *   - social    → `subject` (the provider's stable user id; no secret at all)
 *   - recovery  → `codeHashes` (hashes of one-time recovery codes)
 *   - passkey   → `publicKey` (WebAuthn public key; the private key never leaves
 *                  the user's device). Optional / Tier-1.
 */

interface CredentialBase {
  readonly id: CredentialId;
  readonly accountId: AccountId;
  readonly createdAt: EpochMillis;
}

export interface PasswordCredential extends CredentialBase {
  readonly kind: "password";
  readonly hashRef: string;
  readonly updatedAt: EpochMillis;
}

export interface TotpCredential extends CredentialBase {
  readonly kind: "totp";
  readonly secretRef: string;
  /** Set once the user has proven possession by entering a valid code. */
  readonly confirmedAt?: EpochMillis;
}

export type SocialProvider = "google" | "apple" | "github" | "microsoft" | "facebook";

export interface SocialCredential extends CredentialBase {
  readonly kind: "social";
  readonly provider: SocialProvider;
  /** The provider's stable subject id (OIDC `sub`). */
  readonly subject: string;
}

export interface RecoveryCredential extends CredentialBase {
  readonly kind: "recovery";
  /** Hashes of unused one-time recovery codes; entries removed as consumed. */
  readonly codeHashes: readonly string[];
}

export interface PasskeyCredential extends CredentialBase {
  readonly kind: "passkey";
  readonly webauthnId: string;
  readonly publicKey: string;
  readonly signCount: number;
}

export type SignatureAlgorithm = "ed25519";

/**
 * A self-generated identity keypair — the basis for **anonymous, phone/email-free
 * accounts** (Threema-style). The account IS the key: registration uploads only
 * the public key; login proves control via challenge-response signature. The
 * private key never leaves the client, and no identifier/PII is required.
 */
export interface PublicKeyCredential extends CredentialBase {
  readonly kind: "public_key";
  readonly algorithm: SignatureAlgorithm;
  readonly publicKey: string;
}

export type Credential =
  | PasswordCredential
  | TotpCredential
  | SocialCredential
  | RecoveryCredential
  | PasskeyCredential
  | PublicKeyCredential;

export type CredentialKind = Credential["kind"];
