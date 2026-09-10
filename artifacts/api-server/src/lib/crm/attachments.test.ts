import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAttachment } from "./attachments.ts";

describe("attachments", () => {
  it("accepts a pdf under the size cap", () => {
    const result = evaluateAttachment({
      filename: "quote.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    assert.equal(result.ok, true);
  });

  it("rejects oversized and executable types", () => {
    assert.equal(
      evaluateAttachment({ filename: "big.pdf", mimeType: "application/pdf", sizeBytes: 20 * 1024 * 1024 }).ok,
      false,
    );
    assert.equal(
      evaluateAttachment({ filename: "x.exe", mimeType: "application/x-msdownload", sizeBytes: 10 }).ok,
      false,
    );
  });
});
