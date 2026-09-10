/// <reference types="node" />
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import type { Algorithm, Version } from "@node-rs/argon2";
import type { PasswordHasher } from "../ports/outbound.js";

// `@node-rs/argon2` exposes `Algorithm`/`Version` as ambient `const enum`s,
// which `isolatedModules` forbids reading across module boundaries. Mirror the
// two members we need as plain literals (see the package's `index.d.ts`).
//   Algorithm.Argon2id === 2
//   Version.V0x13      === 1  (the enum ordinal passed to the native binding)
// The encoded PHC string, however, records the human version tag `v=19`
// (0x13), which is what `needsRehash` must compare against.
const ALGORITHM_ARGON2ID = 2 as Algorithm;
const VERSION_V0X13 = 1 as Version;
const PHC_VERSION_0X13 = 19;

/**
 * Argon2id cost parameters. Defaults follow OWASP's Argon2id guidance
 * (memory ≥ 19 MiB, at least one iteration, single lane). Callers may raise
 * these for higher-security deployments; `needsRehash` then upgrades stored
 * hashes transparently on the next successful login.
 */
export interface Argon2idParams {
  /** Memory cost in KiB. OWASP minimum is 19456 (19 MiB). */
  readonly memoryCost: number;
  /** Number of iterations (time cost). */
  readonly timeCost: number;
  /** Degree of parallelism (lanes). */
  readonly parallelism: number;
}

export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

interface ParsedArgon2 {
  readonly variant: string;
  readonly version: number;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/**
 * Parse the PHC-format encoded hash Argon2 emits, e.g.
 * `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`. Returns `null` when the
 * string is not a recognizable Argon2 encoding.
 */
const parseEncoded = (hashRef: string): ParsedArgon2 | null => {
  const match =
    /^\$argon2(id|i|d)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$[^$]+\$[^$]+$/.exec(hashRef);
  if (match === null) {
    return null;
  }
  return {
    variant: `argon2${match[1]!}`,
    version: Number(match[2]),
    memoryCost: Number(match[3]),
    timeCost: Number(match[4]),
    parallelism: Number(match[5]),
  };
};

/**
 * Production `PasswordHasher` backed by Argon2id via `@node-rs/argon2`.
 *
 * The returned `hashRef` is the self-describing PHC encoding, so verification
 * and `needsRehash` never need external parameter storage. `needsRehash`
 * returns `true` whenever the stored variant/version/cost differs from the
 * configured defaults, letting the login flow upgrade legacy hashes in place.
 */
export class Argon2idPasswordHasher implements PasswordHasher {
  private readonly params: Argon2idParams;

  constructor(params: Partial<Argon2idParams> = {}) {
    this.params = { ...DEFAULT_ARGON2ID_PARAMS, ...params };
  }

  async hash(plaintext: string): Promise<string> {
    return argon2Hash(plaintext, {
      algorithm: ALGORITHM_ARGON2ID,
      version: VERSION_V0X13,
      memoryCost: this.params.memoryCost,
      timeCost: this.params.timeCost,
      parallelism: this.params.parallelism,
    });
  }

  async verify(plaintext: string, hashRef: string): Promise<boolean> {
    try {
      return await argon2Verify(hashRef, plaintext);
    } catch {
      // Malformed/foreign hash strings verify as a non-match rather than throw,
      // keeping the login path a total function over stored credentials.
      return false;
    }
  }

  needsRehash(hashRef: string): boolean {
    const parsed = parseEncoded(hashRef);
    if (parsed === null) {
      return true;
    }
    return (
      parsed.variant !== "argon2id" ||
      parsed.version !== PHC_VERSION_0X13 ||
      parsed.memoryCost !== this.params.memoryCost ||
      parsed.timeCost !== this.params.timeCost ||
      parsed.parallelism !== this.params.parallelism
    );
  }
}
