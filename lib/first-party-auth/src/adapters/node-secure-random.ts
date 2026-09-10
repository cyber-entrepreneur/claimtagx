/// <reference types="node" />
import { randomBytes } from "node:crypto";
import type { SecureRandom } from "../shared/random.js";

/** SecureRandom backed by Node `crypto.randomBytes`. */
export class NodeSecureRandom implements SecureRandom {
  bytes(n: number): Uint8Array {
    return new Uint8Array(randomBytes(n));
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive integer");
    }
    if (maxExclusive === 1) {
      return 0;
    }

    const maxUint32 = 0x1_0000_0000;
    const limit = maxUint32 - (maxUint32 % maxExclusive);
    let value: number;
    do {
      value = randomBytes(4).readUInt32BE(0);
    } while (value >= limit);
    return value % maxExclusive;
  }
}
