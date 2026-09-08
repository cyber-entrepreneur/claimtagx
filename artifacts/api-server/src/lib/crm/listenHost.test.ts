import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isWildcardBind, resolveListenHost } from "./listenHost.ts";

describe("listen host policy", () => {
  it("defaults development to loopback", () => {
    assert.equal(resolveListenHost({ NODE_ENV: "development" }), "127.0.0.1");
  });

  it("requires an explicit production bind", () => {
    assert.throws(() => resolveListenHost({ NODE_ENV: "production" }), /LISTEN_HOST is required/);
  });

  it("honors LISTEN_HOST", () => {
    assert.equal(resolveListenHost({ NODE_ENV: "production", LISTEN_HOST: "127.0.0.1" }), "127.0.0.1");
  });

  it("detects wildcard binds", () => {
    assert.equal(isWildcardBind("0.0.0.0"), true);
    assert.equal(isWildcardBind("127.0.0.1"), false);
  });
});
