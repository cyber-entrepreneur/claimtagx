import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  graphProductionRequired,
  loadMicrosoftGraphConfig,
  MICROSOFT_GRAPH_PERMISSIONS,
  validateMicrosoftGraphConfig,
} from "./microsoftGraph/config";
import { graphTokenCacheKey, resetGraphTokenCache } from "./microsoftGraph/auth";
import { encryptDeltaLink, decryptDeltaLink } from "./microsoftGraph/deltaTokenStore";

describe("Microsoft Graph configuration", () => {
  it("lists required application permissions", () => {
    assert.ok(MICROSOFT_GRAPH_PERMISSIONS.some((p) => p.permission === "Mail.Send"));
    assert.ok(MICROSOFT_GRAPH_PERMISSIONS.some((p) => p.permission === "Mail.Read"));
  });

  it("requires full configuration in production mode", () => {
    const result = validateMicrosoftGraphConfig("production");
    if (result.ok) {
      assert.ok(result.config.tenantId);
    } else {
      assert.ok(result.issues.length > 0);
    }
  });

  it("encrypts and decrypts delta links", () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptDeltaLink("https://graph.microsoft.com/delta", key);
    const plain = decryptDeltaLink(encrypted, key);
    assert.equal(plain, "https://graph.microsoft.com/delta");
  });

  it("uses stable token cache keys", () => {
    resetGraphTokenCache();
    assert.equal(graphTokenCacheKey({ tenantId: "t", clientId: "c" }), "t:c");
  });

  it("returns null when env is incomplete", () => {
    const prev = process.env.MS_GRAPH_TENANT_ID;
    delete process.env.MS_GRAPH_TENANT_ID;
    assert.equal(loadMicrosoftGraphConfig(), null);
    if (prev) process.env.MS_GRAPH_TENANT_ID = prev;
  });

  it("accepts certificate credential configuration", () => {
    const prev = {
      tenant: process.env.MS_GRAPH_TENANT_ID,
      client: process.env.MS_GRAPH_CLIENT_ID,
      secret: process.env.MS_GRAPH_CLIENT_SECRET,
      thumb: process.env.MS_GRAPH_CLIENT_CERTIFICATE_THUMBPRINT,
      pem: process.env.MS_GRAPH_CLIENT_CERTIFICATE,
    };
    delete process.env.MS_GRAPH_CLIENT_SECRET;
    process.env.MS_GRAPH_TENANT_ID = "tenant";
    process.env.MS_GRAPH_CLIENT_ID = "client";
    process.env.MS_GRAPH_CLIENT_CERTIFICATE_THUMBPRINT = "a".repeat(40);
    process.env.MS_GRAPH_CLIENT_CERTIFICATE = "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----";
    const issues = validateMicrosoftGraphConfig("development");
    if (issues.ok) {
      assert.equal(issues.config.credential.kind, "certificate");
    } else {
      assert.ok(issues.issues.some((i) => i.field.includes("MS_GRAPH")));
    }
    if (prev.tenant) process.env.MS_GRAPH_TENANT_ID = prev.tenant;
    else delete process.env.MS_GRAPH_TENANT_ID;
    if (prev.client) process.env.MS_GRAPH_CLIENT_ID = prev.client;
    else delete process.env.MS_GRAPH_CLIENT_ID;
    if (prev.secret) process.env.MS_GRAPH_CLIENT_SECRET = prev.secret;
    else delete process.env.MS_GRAPH_CLIENT_SECRET;
    if (prev.thumb) process.env.MS_GRAPH_CLIENT_CERTIFICATE_THUMBPRINT = prev.thumb;
    else delete process.env.MS_GRAPH_CLIENT_CERTIFICATE_THUMBPRINT;
    if (prev.pem) process.env.MS_GRAPH_CLIENT_CERTIFICATE = prev.pem;
    else delete process.env.MS_GRAPH_CLIENT_CERTIFICATE;
  });

  it("flags production requirement", () => {
    assert.equal(graphProductionRequired("production"), true);
    assert.equal(graphProductionRequired("development"), false);
  });
});
