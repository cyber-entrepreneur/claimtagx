import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeChannelStatus, firstPartyEvidenceBlocked, resolveDeclaredStatus } from "./connectors/util.ts";

describe("channel status integrity", () => {
  it("never treats simulator or test-job flags as live", () => {
    assert.equal(
      firstPartyEvidenceBlocked({
        CRM_CHANNEL_SIMULATOR: "true",
      }),
      true,
    );
    assert.equal(firstPartyEvidenceBlocked({ CRM_ALLOW_TEST_JOBS: "true" }), true);
    assert.equal(firstPartyEvidenceBlocked({ CRM_EMAIL_SIMULATOR: "true" }), true);
    assert.equal(firstPartyEvidenceBlocked({ CRM_GRAPH_SIMULATOR: "true" }), true);
    assert.equal(
      composeChannelStatus({
        declared: "IMPLEMENTED_AWAITING_CREDENTIALS",
        liveVerifiedAt: null,
      }),
      "IMPLEMENTED_AWAITING_CREDENTIALS",
    );
  });

  it("never mints LIVE_VERIFIED from environment flags", () => {
    const env = {
      CRM_GRAPH_LIVE_VERIFIED: "true",
      CRM_WHATSAPP_LIVE_VERIFIED: "true",
      META_LIVE_VERIFIED: "true",
      X_LIVE_VERIFIED: "true",
    } as NodeJS.ProcessEnv;
    assert.equal(
      resolveDeclaredStatus({
        channel: "whatsapp",
        implemented: true,
        credentialsReady: true,
        env,
      }),
      "IMPLEMENTED_AWAITING_CREDENTIALS",
    );
    assert.equal(
      composeChannelStatus({
        declared: "IMPLEMENTED_AWAITING_CREDENTIALS",
        liveVerifiedAt: null,
        credentialConfigured: true,
      }),
      "IMPLEMENTED_AWAITING_CREDENTIALS",
    );
  });

  it("does not display LIVE_VERIFIED after credentials are cleared, even if historical evidence exists", () => {
    assert.equal(
      composeChannelStatus({
        declared: "IMPLEMENTED_AWAITING_CREDENTIALS",
        liveVerifiedAt: new Date(),
        credentialConfigured: false,
      }),
      "IMPLEMENTED_AWAITING_CREDENTIALS",
    );
    assert.equal(
      composeChannelStatus({
        declared: "ERROR",
        liveVerifiedAt: new Date(),
        credentialConfigured: true,
      }),
      "ERROR",
    );
  });

  it("keeps ERROR as a reachable displayed status", () => {
    assert.equal(
      resolveDeclaredStatus({
        channel: "whatsapp",
        implemented: true,
        credentialsReady: true,
        error: true,
      }),
      "ERROR",
    );
  });
});
