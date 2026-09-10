/// <reference types="node" />
import type { EpochMillis } from "../shared/clock.js";
import type { SecureRandom } from "../shared/random.js";
import type { TotpAuthenticator, TotpEnrollment } from "../ports/outbound.js";
import { buildOtpauthUri, encodeBase32, totpAtMillis, verifyTotp } from "./totp-core.js";

/**
 * RFC 6238 TOTP authenticator with in-memory secret storage.
 *
 * The secret lives in a process-local Map keyed by an opaque `secretRef`, so it
 * is NOT durable across restarts or shared across instances. Kept for tests and
 * local development — production compositions use `EncryptedTotpAuthenticator`,
 * whose `secretRef` is a self-contained encrypted blob.
 */
export class Rfc6238TotpAuthenticator implements TotpAuthenticator {
  private readonly secrets = new Map<string, Uint8Array>();

  constructor(private readonly random: SecureRandom) {}

  async enroll(params: { readonly issuer: string; readonly label: string }): Promise<TotpEnrollment> {
    const secretBytes = this.random.bytes(20);
    const secretRef = Buffer.from(this.random.bytes(16)).toString("base64url");
    this.secrets.set(secretRef, secretBytes);
    const secretBase32 = encodeBase32(secretBytes);
    return {
      secretRef,
      otpauthUri: buildOtpauthUri(params.issuer, params.label, secretBase32),
    };
  }

  async verify(secretRef: string, code: string, now: EpochMillis): Promise<boolean> {
    const secret = this.secrets.get(secretRef);
    if (secret === undefined) {
      return false;
    }
    return verifyTotp(secret, code, now);
  }

  /** Test helper: current TOTP for a secretRef at `now` (not part of the port). */
  codeAt(secretRef: string, now: EpochMillis): string | undefined {
    const secret = this.secrets.get(secretRef);
    if (secret === undefined) {
      return undefined;
    }
    return totpAtMillis(secret, now);
  }
}
