/// <reference types="node" />
import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import type { EpochMillis } from "../shared/clock.js";
import type { SecureRandom } from "../shared/random.js";
import type { TotpAuthenticator, TotpEnrollment } from "../ports/outbound.js";
import { buildOtpauthUri, encodeBase32, totpAtMillis, verifyTotp } from "./totp-core.js";

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM nonce
const TAG_BYTES = 16; // GCM auth tag
const SECRET_BYTES = 20; // 160-bit TOTP secret (RFC 4226 recommended)
const SECRET_REF_PREFIX = "etotp1"; // versioned so the format can evolve

/**
 * Decode a 32-byte AES key supplied as base64, base64url, or hex. Throws on any
 * other length so a misconfigured `AUTH_MFA_ENCRYPTION_KEY` fails loudly at
 * boot rather than silently weakening MFA.
 */
export const decodeMfaEncryptionKey = (encoded: string): Buffer => {
  const trimmed = encoded.trim();
  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    candidates.push(Buffer.from(trimmed, "hex"));
  }
  candidates.push(Buffer.from(trimmed, "base64"));
  for (const candidate of candidates) {
    if (candidate.length === KEY_BYTES) {
      return candidate;
    }
  }
  throw new Error(
    `AUTH_MFA_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (base64, base64url, or hex).`,
  );
};

/**
 * Durable, stateless TOTP authenticator.
 *
 * Unlike {@link ../adapters/rfc6238-totp-authenticator.Rfc6238TotpAuthenticator},
 * this adapter keeps NO server-side secret store. The `secretRef` it returns is
 * a self-contained AES-256-GCM sealed blob (version ∥ iv ∥ authTag ∥ ciphertext,
 * base64url-encoded), so any instance holding the encryption key can verify
 * codes — safe for multi-instance production. The plaintext secret only ever
 * exists transiently in memory during enroll/verify.
 */
export class EncryptedTotpAuthenticator implements TotpAuthenticator {
  private readonly key: Buffer;
  private readonly random: SecureRandom;
  private readonly window: number;

  constructor(params: {
    readonly key: Buffer;
    readonly random: SecureRandom;
    readonly window?: number;
  }) {
    if (params.key.length !== KEY_BYTES) {
      throw new Error(`Encryption key must be exactly ${KEY_BYTES} bytes.`);
    }
    this.key = params.key;
    this.random = params.random;
    this.window = params.window ?? 1;
  }

  /** Build an authenticator from an env-style base64/hex key string. */
  static fromEncodedKey(params: {
    readonly encodedKey: string;
    readonly random: SecureRandom;
    readonly window?: number;
  }): EncryptedTotpAuthenticator {
    return new EncryptedTotpAuthenticator({
      key: decodeMfaEncryptionKey(params.encodedKey),
      random: params.random,
      ...(params.window !== undefined ? { window: params.window } : {}),
    });
  }

  private seal(secret: Uint8Array): string {
    const iv = Buffer.from(this.random.bytes(IV_BYTES));
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, tag, ciphertext]).toString("base64url");
    return `${SECRET_REF_PREFIX}.${blob}`;
  }

  private open(secretRef: string): Uint8Array | null {
    const dot = secretRef.indexOf(".");
    if (dot === -1 || secretRef.slice(0, dot) !== SECRET_REF_PREFIX) {
      return null;
    }
    let raw: Buffer;
    try {
      raw = Buffer.from(secretRef.slice(dot + 1), "base64url");
    } catch {
      return null;
    }
    if (raw.length <= IV_BYTES + TAG_BYTES) {
      return null;
    }
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
    } catch {
      // Wrong key or tampered blob.
      return null;
    }
  }

  async enroll(params: { readonly issuer: string; readonly label: string }): Promise<TotpEnrollment> {
    const secret = this.random.bytes(SECRET_BYTES);
    const secretRef = this.seal(secret);
    return {
      secretRef,
      otpauthUri: buildOtpauthUri(params.issuer, params.label, encodeBase32(secret)),
    };
  }

  async verify(secretRef: string, code: string, now: EpochMillis): Promise<boolean> {
    const secret = this.open(secretRef);
    if (secret === null) {
      return false;
    }
    return verifyTotp(secret, code, now, this.window);
  }

  /** Test helper: current TOTP for a sealed secretRef at `now`. */
  codeAt(secretRef: string, now: EpochMillis): string | undefined {
    const secret = this.open(secretRef);
    if (secret === null) {
      return undefined;
    }
    return totpAtMillis(secret, now);
  }
}

/** Exposed for tests that need constant-time code comparison semantics. */
export const codesEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};
