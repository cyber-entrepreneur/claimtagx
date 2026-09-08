import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  associateToConversation,
  buildThreadingHeaders,
  createMemoryWebhookEventStore,
  generateMessageId,
  idempotentWebhookEvent,
  normalizeMessageId,
  parseInboundHeaders,
  parseReferencesHeader,
  verifyWebhookTimestamp,
} from "./emailThreading.ts";

describe("generateMessageId", () => {
  it("returns a bracketed RFC token for a valid domain", () => {
    const id = generateMessageId("claimtagx.com");
    assert.match(id, /^<[0-9a-f-]{36}@claimtagx\.com>$/i);
  });

  it("strips wrapping characters from the domain", () => {
    const id = generateMessageId("<@Sales.ClaimTagX.com>");
    assert.match(id, /^<[0-9a-f-]{36}@sales\.claimtagx\.com>$/i);
  });

  it("rejects an invalid domain", () => {
    assert.throws(() => generateMessageId("not a domain"), /Invalid Message-ID domain/);
    assert.throws(() => generateMessageId("localhost"), /Invalid Message-ID domain/);
  });

  it("produces unique ids", () => {
    assert.notEqual(generateMessageId("claimtagx.com"), generateMessageId("claimtagx.com"));
  });
});

describe("buildThreadingHeaders", () => {
  it("starts a new thread when there is no parent", () => {
    const headers = buildThreadingHeaders(undefined, "claimtagx.com");
    assert.match(headers.messageId, /@claimtagx\.com>$/);
    assert.equal(headers.inReplyTo, undefined);
    assert.equal(headers.references, undefined);
  });

  it("sets In-Reply-To and References from the parent Message-ID", () => {
    const parentId = "<ack-1@claimtagx.com>";
    const headers = buildThreadingHeaders({ messageId: parentId }, "claimtagx.com");
    assert.equal(headers.inReplyTo, parentId);
    assert.equal(headers.references, parentId);
    assert.notEqual(headers.messageId, parentId);
  });

  it("appends the parent to an existing References chain", () => {
    const headers = buildThreadingHeaders(
      {
        messageId: "reply-2@claimtagx.com",
        referencesHeader: "<ack-1@claimtagx.com> <reply-2@claimtagx.com>",
      },
      "claimtagx.com",
    );
    assert.equal(headers.inReplyTo, "<reply-2@claimtagx.com>");
    assert.equal(headers.references, "<ack-1@claimtagx.com> <reply-2@claimtagx.com>");
  });
});

describe("parseInboundHeaders", () => {
  it("normalizes explicit Message-ID / In-Reply-To / References", () => {
    const parsed = parseInboundHeaders({
      messageId: "abc@example.com",
      inReplyTo: "<parent@claimtagx.com>",
      references: "<root@claimtagx.com> <parent@claimtagx.com>",
    });
    assert.equal(parsed.messageId, "<abc@example.com>");
    assert.equal(parsed.inReplyTo, "<parent@claimtagx.com>");
    assert.deepEqual(parsed.references, ["<root@claimtagx.com>", "<parent@claimtagx.com>"]);
    assert.equal(parsed.referencesHeader, "<root@claimtagx.com> <parent@claimtagx.com>");
  });

  it("reads case-insensitive header maps", () => {
    const parsed = parseInboundHeaders({
      headers: {
        "Message-ID": "<m@example.com>",
        "In-Reply-To": "<p@claimtagx.com>",
        References: "<r@claimtagx.com>",
      },
    });
    assert.equal(parsed.messageId, "<m@example.com>");
    assert.equal(parsed.inReplyTo, "<p@claimtagx.com>");
    assert.deepEqual(parsed.references, ["<r@claimtagx.com>"]);
  });

  it("returns nulls when headers are absent", () => {
    const parsed = parseInboundHeaders({});
    assert.equal(parsed.messageId, null);
    assert.equal(parsed.inReplyTo, null);
    assert.deepEqual(parsed.references, []);
    assert.equal(parsed.referencesHeader, null);
  });
});

describe("associateToConversation", () => {
  it("extracts CTX-YYYY-NNNNNN from the subject", () => {
    const result = associateToConversation({
      subject: "Re: ClaimTagX Inquiry CTX-2026-000042",
    });
    assert.equal(result.reference, "CTX-2026-000042");
    assert.equal(result.referenceSource, "subject");
    assert.equal(result.parentMessageId, null);
  });

  it("returns In-Reply-To as the parent when the subject has no reference", () => {
    const result = associateToConversation({
      subject: "Thanks",
      inReplyTo: "<ack-1@claimtagx.com>",
    });
    assert.equal(result.reference, null);
    assert.equal(result.referenceSource, "none");
    assert.equal(result.parentMessageId, "<ack-1@claimtagx.com>");
  });

  it("falls back to the first References token", () => {
    const result = associateToConversation({
      references: ["<root@claimtagx.com>", "<later@claimtagx.com>"],
    });
    assert.equal(result.parentMessageId, "<root@claimtagx.com>");
  });
});

describe("verifyWebhookTimestamp", () => {
  const now = Date.parse("2026-09-01T08:00:00.000Z");

  it("accepts a timestamp inside the replay window", () => {
    const result = verifyWebhookTimestamp(now - 30_000, now);
    assert.equal(result.ok, true);
  });

  it("rejects a timestamp outside the replay window", () => {
    const result = verifyWebhookTimestamp(now - 10 * 60_000, now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "replay_window");
  });

  it("accepts unix seconds and ISO strings", () => {
    assert.equal(verifyWebhookTimestamp(now / 1000, now).ok, true);
    assert.equal(verifyWebhookTimestamp("2026-09-01T07:59:50.000Z", now).ok, true);
  });

  it("rejects an unparseable timestamp", () => {
    const result = verifyWebhookTimestamp("not-a-date", now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_timestamp");
  });
});

describe("idempotentWebhookEvent", () => {
  it("claims a new event and treats the second call as a duplicate", async () => {
    const store = createMemoryWebhookEventStore();
    const first = await idempotentWebhookEvent("evt_123", store);
    const second = await idempotentWebhookEvent("evt_123", store);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(first.eventId, "evt_123");
  });

  it("rejects an empty provider event id", async () => {
    const store = createMemoryWebhookEventStore();
    await assert.rejects(() => idempotentWebhookEvent("  ", store), /providerEventId is required/);
  });
});

describe("normalizeMessageId / parseReferencesHeader", () => {
  it("wraps a bare token", () => {
    assert.equal(normalizeMessageId("a@b.com"), "<a@b.com>");
  });

  it("deduplicates references", () => {
    assert.deepEqual(parseReferencesHeader("<a@x.com> <a@x.com> <b@x.com>"), [
      "<a@x.com>",
      "<b@x.com>",
    ]);
  });
});
