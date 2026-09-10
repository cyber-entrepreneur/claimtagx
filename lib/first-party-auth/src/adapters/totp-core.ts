/// <reference types="node" />
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EpochMillis } from "../shared/clock.js";

/**
 * Shared RFC 6238 / RFC 4226 primitives used by every TOTP authenticator
 * adapter. Pure functions over a raw secret — where and how that secret is
 * stored (process Map, encrypted blob, KMS handle) is the adapter's concern.
 */

export const PERIOD_SEC = 30;
export const DIGITS = 6;
/** How many ±periods either side of `now` are accepted (clock-skew tolerance). */
export const DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const encodeBase32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const index = (value >>> bits) & 0x1f;
      output += BASE32_ALPHABET[index] ?? "";
    }
  }
  if (bits > 0) {
    const index = (value << (5 - bits)) & 0x1f;
    output += BASE32_ALPHABET[index] ?? "";
  }
  return output;
};

export const buildOtpauthUri = (
  issuer: string,
  label: string,
  secretBase32: string,
): string => {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedLabel = encodeURIComponent(label);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SEC),
  });
  return `otpauth://totp/${encodedIssuer}:${encodedLabel}?${params.toString()}`;
};

const counterToBuffer = (counter: number): Buffer => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
};

export const hotp = (secret: Uint8Array, counter: number): string => {
  const digest = createHmac("sha1", secret).update(counterToBuffer(counter)).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  const otp = binary % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, "0");
};

export const totpAt = (secret: Uint8Array, epochSec: number): string => {
  const counter = Math.floor(epochSec / PERIOD_SEC);
  return hotp(secret, counter);
};

export const totpAtMillis = (secret: Uint8Array, now: EpochMillis): string =>
  totpAt(secret, Math.floor(now / 1000));

const safeEqualCodes = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

/** Constant-time verification across the ±`window` clock-skew tolerance. */
export const verifyTotp = (
  secret: Uint8Array,
  code: string,
  now: EpochMillis,
  window: number = DEFAULT_WINDOW,
): boolean => {
  const epochSec = Math.floor(now / 1000);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = totpAt(secret, epochSec + offset * PERIOD_SEC);
    if (safeEqualCodes(candidate, code)) {
      return true;
    }
  }
  return false;
};
