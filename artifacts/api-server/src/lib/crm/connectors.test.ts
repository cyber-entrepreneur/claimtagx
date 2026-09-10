import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { ROLE_PERMISSIONS, hasPermission } from "./rbac.ts";
import { getChannelAdapter, listChannelAdapters, inquiryChannelToInbox } from "./connectors/registry.ts";
import { verifyMetaSha256Signature, metaVerifyChallenge } from "./connectors/metaSignature.ts";
import { CHANNEL_STATUSES } from "./connectors/types.ts";
import { xAdapter } from "./connectors/x.ts";
import { whatsappAdapter, buildWhatsAppSendPayload } from "./connectors/whatsapp.ts";
import { messengerAdapter, instagramAdapter } from "./connectors/metaMessaging.ts";
import { tiktokAdapter, linkedinAdapter } from "./connectors/gated.ts";
import { websiteAdapter } from "./connectors/website.ts";
import { microsoft365Adapter } from "./connectors/microsoft365.ts";
import { ConnectorCapabilityError } from "./connectors/types.ts";
import { assertInquiryAccess } from "./objectAuth.ts";
import type { CrmStaff } from "@workspace/db";

const WHATSAPP_INBOUND = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "biz",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "123" },
            contacts: [{ profile: { name: "Ada" }, wa_id: "15551234567" }],
            messages: [
              {
                from: "15551234567",
                id: "wamid.ABC",
                timestamp: "1710000000",
                type: "text",
                text: { body: "Need a demo" },
              },
            ],
          },
        },
      ],
    },
  ],
};

const MESSENGER_INBOUND = {
  object: "page",
  entry: [
    {
      id: "page-1",
      messaging: [
        {
          sender: { id: "psid-9" },
          recipient: { id: "page-1" },
          timestamp: 1710000000000,
          message: { mid: "mid.1", text: "Hello from Messenger" },
        },
      ],
    },
  ],
};

const INSTAGRAM_INBOUND = {
  object: "instagram",
  entry: [
    {
      id: "ig-1",
      messaging: [
        {
          sender: { id: "igid-2" },
          recipient: { id: "ig-1" },
          timestamp: 1710000000000,
          message: { mid: "igmid.1", text: "Hello from Instagram" },
        },
      ],
    },
  ],
};

const X_INBOUND = {
  for_user_id: "acct",
  direct_message_events: [
    {
      id: "dm-1",
      type: "message_create",
      message_create: {
        sender_id: "user-22",
        target: { recipient_id: "acct" },
        message_data: { text: "Hello from X" },
      },
    },
  ],
};

describe("omnichannel connectors", () => {
  it("never labels gated channels live", () => {
    for (const adapter of listChannelAdapters()) {
      const health = adapter.healthCheck();
      assert.equal(health.simulator, false);
      assert.equal(CHANNEL_STATUSES.includes(health.status), true);
      if (adapter.channel === "tiktok") {
        assert.equal(health.status, "UNSUPPORTED_BY_PUBLIC_API");
        assert.equal(health.live, false);
      }
      if (adapter.channel === "linkedin") {
        assert.equal(health.status, "PARTNER_GATED");
        assert.equal(health.live, false);
      }
      assert.equal(health.live, false);
    }
    assert.equal(websiteAdapter.healthCheck().live, false);
    assert.equal(websiteAdapter.healthCheck().status, "IMPLEMENTED_AWAITING_CREDENTIALS");
    assert.equal(websiteAdapter.capabilities().attachments, false);
    assert.equal(whatsappAdapter.capabilities().attachments, false);
    assert.equal(messengerAdapter.capabilities().attachments, false);
    assert.equal(instagramAdapter.capabilities().attachments, false);
    assert.equal(xAdapter.capabilities().attachments, false);
    assert.equal(microsoft365Adapter.capabilities().attachments, false);
    assert.equal(whatsappAdapter.capabilities().templates, true);
    assert.equal(whatsappAdapter.capabilities().reconciliation, false);
  });

  it("verifies Meta signatures and WhatsApp normalization", () => {
    const raw = JSON.stringify(WHATSAPP_INBOUND);
    const secret = "app-secret";
    const header = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    assert.equal(verifyMetaSha256Signature({ rawBody: raw, header, appSecret: secret }), true);
    assert.equal(verifyMetaSha256Signature({ rawBody: raw, header: "sha256=dead", appSecret: secret }), false);
    const events = whatsappAdapter.parseInboundEvents(WHATSAPP_INBOUND);
    assert.equal(events.length, 1);
    const canonical = whatsappAdapter.normalizeInboundMessage(events[0]);
    assert.ok(canonical);
    assert.equal(canonical.providerMessageId, "wamid.ABC");
    assert.equal(canonical.externalThreadId, "15551234567");
    assert.equal(canonical.bodyText, "Need a demo");
    const dup = whatsappAdapter.parseInboundEvents(WHATSAPP_INBOUND);
    assert.equal(dup[0].providerEventId, events[0].providerEventId);
  });

  it("maps WhatsApp delivery statuses", () => {
    assert.equal(whatsappAdapter.mapDeliveryStatus({ id: "wamid.ABC", status: "delivered" })?.status, "delivered");
    assert.equal(whatsappAdapter.mapDeliveryStatus({ id: "wamid.ABC", status: "read" })?.status, "read");
    assert.equal(whatsappAdapter.mapDeliveryStatus({ id: "wamid.ABC", status: "failed" })?.status, "failed");
  });

  it("builds official WhatsApp template payloads without unofficial idempotency headers", () => {
    const payload = buildWhatsAppSendPayload({
      channelAccountId: "a",
      text: "hi",
      templateName: "hello_world",
      templateLanguage: "en",
      idempotencyKey: "internal-only",
      toPhone: "+15551234567",
    });
    assert.equal(payload.type, "template");
    assert.deepEqual(payload.template, { name: "hello_world", language: { code: "en" } });
  });

  it("normalizes Messenger and Instagram independently", () => {
    const m = messengerAdapter.parseInboundEvents(MESSENGER_INBOUND);
    const i = instagramAdapter.parseInboundEvents(INSTAGRAM_INBOUND);
    const cm = messengerAdapter.normalizeInboundMessage(m[0]);
    const ci = instagramAdapter.normalizeInboundMessage(i[0]);
    assert.equal(cm?.channel, "messenger");
    assert.equal(ci?.channel, "instagram");
    assert.equal(cm?.externalThreadId, "psid-9");
    assert.equal(ci?.externalThreadId, "igid-2");
    assert.notEqual(cm?.externalThreadId, ci?.externalThreadId);
  });

  it("handles X CRC and rejects unsigned POST", () => {
    process.env.X_CONSUMER_SECRET = "x-secret";
    const crc = xAdapter.verifyWebhook({
      nodeEnv: "test",
      rawBody: "",
      headers: {},
      query: { crc_token: "token" },
      body: {},
    });
    assert.equal(crc.kind, "challenge");
    const unsigned = xAdapter.verifyWebhook({
      nodeEnv: "test",
      rawBody: JSON.stringify(X_INBOUND),
      headers: {},
      query: {},
      body: X_INBOUND,
    });
    assert.equal(unsigned.kind, "rejected");
    if (unsigned.kind === "rejected") assert.equal(unsigned.reason, "missing_signature");
    const events = xAdapter.parseInboundEvents(X_INBOUND);
    const canonical = xAdapter.normalizeInboundMessage(events[0]);
    assert.equal(canonical?.bodyText, "Hello from X");
    assert.equal(canonical?.channel, "x");
  });

  it("rejects TikTok and LinkedIn send", async () => {
    await assert.rejects(
      () => tiktokAdapter.sendMessage({ channelAccountId: "x", text: "hi", idempotencyKey: "k" }),
      (err: unknown) => err instanceof ConnectorCapabilityError && err.code === "UNSUPPORTED_BY_PUBLIC_API",
    );
    await assert.rejects(
      () => linkedinAdapter.sendMessage({ channelAccountId: "x", text: "hi", idempotencyKey: "k" }),
      (err: unknown) => err instanceof ConnectorCapabilityError && err.code === "PARTNER_GATED",
    );
    assert.equal(tiktokAdapter.verifyWebhook({ nodeEnv: "test", rawBody: "", headers: {}, query: {}, body: {} }).kind, "rejected");
  });

  it("maps website form channel to the website adapter", () => {
    assert.equal(inquiryChannelToInbox("web_form"), "website");
    assert.equal(getChannelAdapter("microsoft365").capabilities().polling, true);
    assert.equal(microsoft365Adapter.capabilities().webhooks, true);
  });

  it("echoes Meta hub challenges", () => {
    const challenge = metaVerifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "v", "hub.challenge": "123" }, "v");
    assert.equal(challenge, "123");
    assert.equal(metaVerifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "123" }, "v"), null);
  });

  it("grants agent reply and denies auditor messaging", () => {
    assert.equal(hasPermission(ROLE_PERMISSIONS.agent, "inquiries.reply"), true);
    assert.equal(hasPermission(ROLE_PERMISSIONS.auditor, "inquiries.reply"), false);
    assert.equal(hasPermission(ROLE_PERMISSIONS.supervisor, "inquiries.assign"), true);
    assert.equal(hasPermission(ROLE_PERMISSIONS.admin, "channels.manage"), true);
    const auditor = { id: "a", role: "auditor", permissions: [], email: "a", emailNormalized: "a", name: "A", status: "active" } as CrmStaff;
    assert.throws(() => assertInquiryAccess(auditor, { assignedStaffId: null }, "mutate"));
    const supervisor = { id: "s", role: "supervisor", permissions: [], email: "s", emailNormalized: "s", name: "S", status: "active" } as CrmStaff;
    assert.doesNotThrow(() => assertInquiryAccess(supervisor, { assignedStaffId: "other" }, "assign"));
    const agent = { id: "ag", role: "agent", teamId: "team-1", permissions: [], email: "ag", emailNormalized: "ag", name: "Ag", status: "active" } as CrmStaff;
    assert.throws(() => assertInquiryAccess(agent, { assignedStaffId: "other", assignedTeamId: "team-2" }, "view"));
    assert.doesNotThrow(() => assertInquiryAccess(agent, { assignedStaffId: "other", assignedTeamId: "team-1" }, "view"));
    assert.throws(() => assertInquiryAccess(agent, { assignedStaffId: "other", assignedTeamId: "team-1" }, "mutate"));
  });
});
