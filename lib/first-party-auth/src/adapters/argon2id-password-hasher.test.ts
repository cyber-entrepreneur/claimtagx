import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Argon2idPasswordHasher } from "./argon2id-password-hasher.js";

describe("Argon2idPasswordHasher", () => {
  it("hashes to a self-describing argon2id PHC string and verifies", async () => {
    const hasher = new Argon2idPasswordHasher({ memoryCost: 64, timeCost: 2, parallelism: 1 });
    const hashRef = await hasher.hash("correct-horse-battery-staple");
    assert.match(hashRef, /^\$argon2id\$v=19\$m=64,t=2,p=1\$/);
    assert.equal(await hasher.verify("correct-horse-battery-staple", hashRef), true);
    assert.equal(await hasher.verify("wrong-password", hashRef), false);
  });

  it("needsRehash is false for a hash produced with matching params", async () => {
    const hasher = new Argon2idPasswordHasher({ memoryCost: 64, timeCost: 2, parallelism: 1 });
    const hashRef = await hasher.hash("s3cret-password");
    assert.equal(hasher.needsRehash(hashRef), false);
  });

  it("needsRehash is true when stored cost is weaker than configured defaults", async () => {
    const weak = new Argon2idPasswordHasher({ memoryCost: 8, timeCost: 2, parallelism: 1 });
    const strong = new Argon2idPasswordHasher({ memoryCost: 64, timeCost: 2, parallelism: 1 });
    const legacyHash = await weak.hash("s3cret-password");
    assert.equal(strong.needsRehash(legacyHash), true);
    // The stronger hasher can still verify the legacy hash (params are embedded).
    assert.equal(await strong.verify("s3cret-password", legacyHash), true);
  });

  it("needsRehash is true for a foreign / unparsable hash", () => {
    const hasher = new Argon2idPasswordHasher();
    assert.equal(hasher.needsRehash("scrypt$16384$8$1$abc$def"), true);
    assert.equal(hasher.needsRehash("not-a-hash"), true);
  });

  it("verify returns false (does not throw) for a malformed hash", async () => {
    const hasher = new Argon2idPasswordHasher();
    assert.equal(await hasher.verify("whatever", "not-a-valid-encoded-hash"), false);
  });
});
