import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  graphNotificationAuthorized,
  graphNotificationEventId,
  MICROSOFT_GRAPH_WEBHOOK_CONTRACT,
  parseGraphNotifications,
  respondGraphValidationToken,
  verifyGraphClientState,
} from "./microsoftGraph/webhookSecurity";

describe("Microsoft Graph webhook security", () => {
  it("documents the provider contract", () => {
    assert.equal(MICROSOFT_GRAPH_WEBHOOK_CONTRACT.provider, "Microsoft Graph");
    assert.equal(MICROSOFT_GRAPH_WEBHOOK_CONTRACT.validationQueryParam, "validationToken");
  });

  it("returns validation token verbatim", () => {
    const response = respondGraphValidationToken("abc123");
    assert.equal(response.status, 200);
    assert.equal(response.body, "abc123");
  });

  it("verifies client state with timing-safe compare", () => {
    assert.equal(verifyGraphClientState("secret-state", "secret-state").ok, true);
    assert.equal(verifyGraphClientState("wrong", "secret-state").reason, "bad_client_state");
  });

  it("parses change notifications", () => {
    const notifications = parseGraphNotifications({
      value: [
        {
          subscriptionId: "sub-1",
          clientState: "state",
          changeType: "created",
          resource: "Users/u/Messages/abc",
          resourceData: { id: "abc" },
        },
      ],
    });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.resourceData?.id, "abc");
  });

  it("authorizes a batch when client state matches", () => {
    const notifications = parseGraphNotifications({
      value: [
        {
          subscriptionId: "sub-1",
          clientState: "expected",
          changeType: "created",
          resource: "Users/u/Messages/abc",
        },
      ],
    });
    const authz = graphNotificationAuthorized(
      {
        tenantId: "t",
        clientId: "c",
        credential: { kind: "secret", clientSecret: "s" },
        mailboxUpn: "ops@example.com",
        notificationUrl: "https://example.com/hook",
        clientState: "expected",
        deltaEncryptionKey: Buffer.alloc(32),
      },
      notifications,
    );
    assert.equal(authz.ok, true);
  });

  it("derives stable notification event ids", () => {
    const id = graphNotificationEventId({
      subscriptionId: "sub",
      clientState: "s",
      changeType: "created",
      resource: "Users/u/Messages/abc",
      resourceData: { id: "abc" },
    });
    assert.match(id, /^[a-f0-9]{64}$/);
  });
});
