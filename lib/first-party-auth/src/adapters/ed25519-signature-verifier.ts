/// <reference types="node" />
/**
 * Reference SignatureVerifier: REAL Ed25519 verification via Node `crypto`.
 * `publicKey` is base64 of the raw 32-byte Ed25519 public key; it is wrapped in
 * the fixed SPKI DER prefix so Node can import it as a KeyObject. Not a stub —
 * a bad signature genuinely fails.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { SignatureVerifier } from "../ports/outbound.js";
import type { SignatureAlgorithm } from "../domain/credential.js";

// SPKI DER header for an Ed25519 public key (RFC 8410), followed by the 32 raw bytes.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export class Ed25519SignatureVerifier implements SignatureVerifier {
  async verify(input: {
    readonly algorithm: SignatureAlgorithm;
    readonly publicKey: string;
    readonly message: Uint8Array;
    readonly signature: Uint8Array;
  }): Promise<boolean> {
    if (input.algorithm !== "ed25519") return false;
    let raw: Buffer;
    try {
      raw = Buffer.from(input.publicKey, "base64");
    } catch {
      return false;
    }
    if (raw.length !== 32) return false;

    try {
      const keyObject = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
        format: "der",
        type: "spki",
      });
      // Ed25519 uses no separate digest algorithm → first arg is null.
      return cryptoVerify(null, Buffer.from(input.message), keyObject, Buffer.from(input.signature));
    } catch {
      return false;
    }
  }
}
