/// <reference types="node" />
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import type { PasswordHasher } from "../ports/outbound.js";

const scryptAsync = (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });

const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

const parseHashRef = (hashRef: string): { params: ScryptParams; salt: Buffer; hash: Buffer } => {
  const parts = hashRef.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("Invalid scrypt hash format");
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltB64 = parts[4];
  const hashB64 = parts[5];
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    saltB64 === undefined ||
    hashB64 === undefined
  ) {
    throw new Error("Invalid scrypt hash format");
  }
  return {
    params: { N, r, p },
    salt: Buffer.from(saltB64, "base64url"),
    hash: Buffer.from(hashB64, "base64url"),
  };
};

const formatHashRef = (
  params: ScryptParams,
  salt: Buffer,
  hash: Buffer,
): string =>
  `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;

/** PasswordHasher using Node `crypto.scrypt` with an encoded parameter prefix. */
export class ScryptPasswordHasher implements PasswordHasher {
  constructor(private readonly defaults: ScryptParams = { N: DEFAULT_N, r: DEFAULT_R, p: DEFAULT_P }) {}

  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_LEN);
    const derived = await scryptAsync(plaintext, salt, KEY_LEN, {
      N: this.defaults.N,
      r: this.defaults.r,
      p: this.defaults.p,
    });
    return formatHashRef(this.defaults, salt, derived);
  }

  async verify(plaintext: string, hashRef: string): Promise<boolean> {
    const { params, salt, hash } = parseHashRef(hashRef);
    const derived = await scryptAsync(plaintext, salt, hash.length, {
      N: params.N,
      r: params.r,
      p: params.p,
    });
    if (derived.length !== hash.length) {
      return false;
    }
    return timingSafeEqual(derived, hash);
  }

  needsRehash(hashRef: string): boolean {
    const { params } = parseHashRef(hashRef);
    return (
      params.N !== this.defaults.N ||
      params.r !== this.defaults.r ||
      params.p !== this.defaults.p
    );
  }
}
