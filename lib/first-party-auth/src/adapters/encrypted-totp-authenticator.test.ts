/// <reference types="node" />
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { epochMillis } from "../shared/clock.js";
import { NodeSecureRandom } from "./node-secure-random.js";
import {
  EncryptedTotpAuthenticator,
  decodeMfaEncryptionKey,
} from "./encrypted-totp-authenticator.js";

const KEY = randomBytes(32);
const NOW = epochMillis(1_700_000_000_000);

describe("EncryptedTotpAuthenticator", () => {
  it("produces a self-contained secretRef that verifies a current code", async () => {
    const auth = new EncryptedTotpAuthenticator({ key: KEY, random: new NodeSecureRandom() });
    const enrollment = await auth.enroll({ issuer: "ClaimTagX", label: "user@example.com" });
    assert.match(enrollment.secretRef, /^etotp1\./);
    assert.match(enrollment.otpauthUri, /^otpauth:\/\/totp\//);

    const code = auth.codeAt(enrollment.secretRef, NOW);
    assert.ok(code);
    assert.equal(await auth.verify(enrollment.secretRef, code!, NOW), true);
    assert.equal(await auth.verify(enrollment.secretRef, "000000", NOW), false);
  });

  it("is durable across instances that share the key (no server-side store)", async () => {
    const enroller = new EncryptedTotpAuthenticator({ key: KEY, random: new NodeSecureRandom() });
    const enrollment = await enroller.enroll({ issuer: "ClaimTagX", label: "durable" });

    // A brand-new instance (e.g. another API pod) holding the same key verifies.
    const other = new EncryptedTotpAuthenticator({ key: KEY, random: new NodeSecureRandom() });
    const code = other.codeAt(enrollment.secretRef, NOW);
    assert.ok(code);
    assert.equal(await other.verify(enrollment.secretRef, code!, NOW), true);
  });

  it("rejects a secretRef sealed under a different key", async () => {
    const enroller = new EncryptedTotpAuthenticator({ key: KEY, random: new NodeSecureRandom() });
    const enrollment = await enroller.enroll({ issuer: "ClaimTagX", label: "attacker" });

    const wrongKey = new EncryptedTotpAuthenticator({
      key: randomBytes(32),
      random: new NodeSecureRandom(),
    });
    const code = enroller.codeAt(enrollment.secretRef, NOW);
    assert.ok(code);
    assert.equal(await wrongKey.verify(enrollment.secretRef, code!, NOW), false);
    assert.equal(wrongKey.codeAt(enrollment.secretRef, NOW), undefined);
  });

  it("decodeMfaEncryptionKey accepts hex and base64 32-byte keys and rejects others", () => {
    assert.equal(decodeMfaEncryptionKey(KEY.toString("hex")).length, 32);
    assert.equal(decodeMfaEncryptionKey(KEY.toString("base64")).length, 32);
    assert.throws(() => decodeMfaEncryptionKey("too-short"));
  });

  it("constructor rejects a non-32-byte key", () => {
    assert.throws(
      () => new EncryptedTotpAuthenticator({ key: randomBytes(16), random: new NodeSecureRandom() }),
    );
  });
});
