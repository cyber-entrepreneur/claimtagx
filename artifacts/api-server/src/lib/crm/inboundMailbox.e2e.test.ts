import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  associateToConversation,
  createMemoryWebhookEventStore,
} from "./emailThreading.ts";
import {
  processInboundWithIdempotency,
  recordOutboundReply,
} from "./inboundMailbox.ts";

describe("email outbound → inbound conversation association (e2e fixture)", () => {
  it("associates a customer reply using In-Reply-To of the outbound Message-ID", async () => {
    const outbound = recordOutboundReply({
      inquiryId: "inq-1",
      conversationId: "conv-1",
      reference: "CTX-2026-000042",
    });
    const store = createMemoryWebhookEventStore();
    const inbound = await processInboundWithIdempotency({
      providerEventId: "evt-reply-1",
      subject: "Re: thanks",
      messageId: "<customer-1@example.com>",
      inReplyTo: outbound.messageId,
      messages: [outbound],
      store,
    });
    assert.equal(inbound.matched, true);
    if (inbound.matched) {
      assert.equal(inbound.inquiryId, "inq-1");
      assert.equal(inbound.reference, "CTX-2026-000042");
    }
  });

  it("associates by CTX reference in the subject when headers are missing", async () => {
    const outbound = recordOutboundReply({
      inquiryId: "inq-2",
      conversationId: "conv-2",
      reference: "CTX-2026-000099",
    });
    const result = associateToConversation({
      subject: `Re: ClaimTagX Inquiry ${outbound.reference}`,
    });
    assert.equal(result.reference, "CTX-2026-000099");
    const inbound = await processInboundWithIdempotency({
      subject: `Re: ClaimTagX Inquiry ${outbound.reference}`,
      messages: [outbound],
      store: createMemoryWebhookEventStore(),
    });
    assert.equal(inbound.matched, true);
  });

  it("quarantines unknown threads", async () => {
    const inbound = await processInboundWithIdempotency({
      subject: "Random sales pitch",
      inReplyTo: "<unknown@other.com>",
      messages: [],
      store: createMemoryWebhookEventStore(),
    });
    assert.equal(inbound.matched, false);
    if (!inbound.matched) {
      assert.equal(inbound.quarantine.reason, "unknown_thread");
    }
  });

  it("treats a replayed provider event as a duplicate", async () => {
    const outbound = recordOutboundReply({
      inquiryId: "inq-3",
      conversationId: "conv-3",
      reference: "CTX-2026-000007",
    });
    const store = createMemoryWebhookEventStore();
    const first = await processInboundWithIdempotency({
      providerEventId: "evt-dup",
      inReplyTo: outbound.messageId,
      messages: [outbound],
      store,
    });
    const second = await processInboundWithIdempotency({
      providerEventId: "evt-dup",
      inReplyTo: outbound.messageId,
      messages: [outbound],
      store,
    });
    assert.equal(first.matched, true);
    assert.equal(second.matched, true);
    if (second.matched) assert.equal(second.duplicate, true);
  });
});
