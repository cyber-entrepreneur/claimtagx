import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountId, SessionId } from "../domain/ids.js";
import type { AuthContext } from "../domain/session.js";
import { epochMillis } from "../shared/clock.js";
import { asId } from "../shared/ids.js";
import { FakeClock } from "./test-fakes.js";
import { NodeSecureRandom } from "./node-secure-random.js";
import {
  InMemoryOpaqueTokenRepository,
  OpaqueTokenService,
  hashToken,
} from "./opaque-token-service.js";

const context = (sessionId: string): AuthContext => ({
  accountId: asId("acc-1") as AccountId,
  sessionId: asId(sessionId) as SessionId,
  scopes: ["read"],
});

describe("OpaqueTokenService", () => {
  it("issues opaque tokens and stores only their hashes", async () => {
    const repo = new InMemoryOpaqueTokenRepository();
    const clock = new FakeClock(1_000);
    const service = new OpaqueTokenService(repo, new NodeSecureRandom(), clock);
    const ctx = context("sess-1");

    const access = await service.issueAccess(ctx, epochMillis(10_000));
    // The raw token is never what gets persisted — only its SHA-256 hash.
    const stored = await repo.findByAccessHash(hashToken(access));
    assert.ok(stored);
    assert.equal(stored?.context.sessionId, ctx.sessionId);
    // A lookup by the raw token value must miss.
    assert.equal(await repo.findByAccessHash(access), undefined);
  });

  it("verifyAccess resolves the principal and rejects unknown/expired tokens", async () => {
    const repo = new InMemoryOpaqueTokenRepository();
    const clock = new FakeClock(1_000);
    const service = new OpaqueTokenService(repo, new NodeSecureRandom(), clock);
    const ctx = context("sess-2");

    const access = await service.issueAccess(ctx, epochMillis(5_000));
    const resolved = await service.verifyAccess(access);
    assert.deepEqual(resolved, ctx);

    assert.equal(await service.verifyAccess("cta_at_bogus"), null);

    clock.set(5_001);
    assert.equal(await service.verifyAccess(access), null);
  });

  it("verifyRefresh returns the session id and honours expiry", async () => {
    const repo = new InMemoryOpaqueTokenRepository();
    const clock = new FakeClock(1_000);
    const service = new OpaqueTokenService(repo, new NodeSecureRandom(), clock);
    const sessionId = asId("sess-3") as SessionId;

    const refresh = await service.issueRefresh(sessionId, epochMillis(5_000));
    assert.equal(await service.verifyRefresh(refresh), sessionId);

    clock.set(6_000);
    assert.equal(await service.verifyRefresh(refresh), null);
  });

  it("rotating a token invalidates the previous one for that slot", async () => {
    const repo = new InMemoryOpaqueTokenRepository();
    const clock = new FakeClock(1_000);
    const service = new OpaqueTokenService(repo, new NodeSecureRandom(), clock);
    const ctx = context("sess-4");

    const first = await service.issueAccess(ctx, epochMillis(10_000));
    const second = await service.issueAccess(ctx, epochMillis(10_000));
    assert.notEqual(first, second);
    assert.equal(await service.verifyAccess(first), null);
    assert.deepEqual(await service.verifyAccess(second), ctx);
  });

  it("revoke drops all token material for the session", async () => {
    const repo = new InMemoryOpaqueTokenRepository();
    const clock = new FakeClock(1_000);
    const service = new OpaqueTokenService(repo, new NodeSecureRandom(), clock);
    const ctx = context("sess-5");
    const sessionId = ctx.sessionId;

    const access = await service.issueAccess(ctx, epochMillis(10_000));
    const refresh = await service.issueRefresh(sessionId, epochMillis(10_000));
    await repo.revoke(sessionId);

    assert.equal(await service.verifyAccess(access), null);
    assert.equal(await service.verifyRefresh(refresh), null);
  });
});
