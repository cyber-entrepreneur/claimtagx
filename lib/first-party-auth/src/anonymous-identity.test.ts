/**
 * Anonymous key-based identity — real Ed25519 challenge-response.
 * No phone/email; login purely by signing a server nonce.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  createAuthPlatform,
  FakeClock,
  InMemoryRateLimiter,
  NodeSecureRandom,
  SequentialIdGenerator,
} from "./index.js";

/** Fresh Ed25519 identity: base64 raw public key + a signer over arbitrary bytes. */
function newIdentity(): { publicKeyBase64: string; sign: (msg: Uint8Array) => Uint8Array } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const rawPub = Buffer.from(jwk.x, "base64url");
  return {
    publicKeyBase64: rawPub.toString("base64"),
    sign: (msg: Uint8Array) => new Uint8Array(cryptoSign(null, Buffer.from(msg), privateKey as KeyObject)),
  };
}

function harness(startMs = 1_700_000_000_000) {
  const clock = new FakeClock(startMs);
  const platform = createAuthPlatform({
    clock,
    ids: new SequentialIdGenerator("anon"),
    random: new NodeSecureRandom(),
    rateLimiter: new InMemoryRateLimiter({ capacity: 100, refillPerMs: 1, clock }),
    jwtSecret: "test-secret",
  });
  return { platform, clock };
}

describe("anonymous key-based identity", () => {
  it("register (no PII) → challenge → sign → login; token verifies", async () => {
    const { platform } = harness();
    const id = newIdentity();

    const reg = await platform.anonymous.register({
      algorithm: "ed25519",
      publicKey: id.publicKeyBase64,
    });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;
    // No identifier / PII on an anonymous account.
    assert.equal(reg.value.account.identifiers.length, 0);
    assert.equal(reg.value.account.status, "active");
    const accountId = reg.value.account.id;

    const ch = await platform.anonymous.beginChallenge({ accountId });
    assert.equal(ch.ok, true);
    if (!ch.ok) return;

    const signature = id.sign(ch.value.nonce);
    const done = await platform.anonymous.completeChallenge({
      challengeId: ch.value.challengeId,
      signature,
    });
    assert.equal(done.ok, true, JSON.stringify(done));
    if (!done.ok) return;
    assert.equal(done.value.status, "authenticated");
    if (done.value.status !== "authenticated") return;

    const verified = await platform.sessions.verify(done.value.tokens.accessToken);
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal(verified.value.accountId, accountId);
  });

  it("wrong signature → SIGNATURE_INVALID", async () => {
    const { platform } = harness();
    const id = newIdentity();
    const attacker = newIdentity();
    const reg = await platform.anonymous.register({ algorithm: "ed25519", publicKey: id.publicKeyBase64 });
    assert.ok(reg.ok);
    if (!reg.ok) return;
    const ch = await platform.anonymous.beginChallenge({ accountId: reg.value.account.id });
    assert.ok(ch.ok);
    if (!ch.ok) return;
    // Sign with the WRONG key.
    const bad = await platform.anonymous.completeChallenge({
      challengeId: ch.value.challengeId,
      signature: attacker.sign(ch.value.nonce),
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.code, "SIGNATURE_INVALID");
  });

  it("challenge is one-time (replay → CHALLENGE_INVALID)", async () => {
    const { platform } = harness();
    const id = newIdentity();
    const reg = await platform.anonymous.register({ algorithm: "ed25519", publicKey: id.publicKeyBase64 });
    assert.ok(reg.ok);
    if (!reg.ok) return;
    const ch = await platform.anonymous.beginChallenge({ accountId: reg.value.account.id });
    assert.ok(ch.ok);
    if (!ch.ok) return;
    const sig = id.sign(ch.value.nonce);
    const first = await platform.anonymous.completeChallenge({ challengeId: ch.value.challengeId, signature: sig });
    assert.ok(first.ok);
    const replay = await platform.anonymous.completeChallenge({ challengeId: ch.value.challengeId, signature: sig });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.error.code, "CHALLENGE_INVALID");
  });

  it("expired challenge → CHALLENGE_EXPIRED", async () => {
    const { platform, clock } = harness();
    const id = newIdentity();
    const reg = await platform.anonymous.register({ algorithm: "ed25519", publicKey: id.publicKeyBase64 });
    assert.ok(reg.ok);
    if (!reg.ok) return;
    const ch = await platform.anonymous.beginChallenge({ accountId: reg.value.account.id });
    assert.ok(ch.ok);
    if (!ch.ok) return;
    clock.advance(3 * 60 * 1000); // past the 2-minute TTL
    const done = await platform.anonymous.completeChallenge({
      challengeId: ch.value.challengeId,
      signature: id.sign(ch.value.nonce),
    });
    assert.equal(done.ok, false);
    if (!done.ok) assert.equal(done.error.code, "CHALLENGE_EXPIRED");
  });
});
