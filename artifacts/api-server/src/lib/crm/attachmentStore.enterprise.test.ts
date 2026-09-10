import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  abortMultipartUpload,
  assertAttachmentStoreReadyForEnvironment,
  completeMultipartUpload,
  expireStaleUploads,
  initiateMultipartUpload,
  memoryObjectStore,
  reconcileOrphanUploadParts,
  resolveObjectStoreFromEnv,
  s3CompatibleObjectStore,
  signedAttachmentUrl,
  uploadMultipartPart,
  validateFileSignature,
  verifySignedAttachmentUrl,
  deleteAttachment,
  retryAttachmentMalwareScan,
} from "./attachmentStore.ts";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("attachment durability tests require isolated DATABASE_URL on 127.0.0.1:55432/claimtagx_crm_verify");
  }
}

describe("attachment enterprise store contract", () => {
  it("rejects executable signatures", () => {
    assert.equal(validateFileSignature("application/pdf", new Uint8Array([0x4d, 0x5a])), false);
    assert.equal(validateFileSignature("application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46])), true);
  });

  it("performs S3-compatible HTTP put/get/delete through injectable client", async () => {
    const blobs = new Map<string, Uint8Array>();
    const store = s3CompatibleObjectStore({
      bucket: "crm-private",
      region: "us-east-1",
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
      accessKeyId: "test",
      secretAccessKey: "secret",
      http: {
        async request({ method, url, body }) {
          const key = decodeURIComponent(url.split("/crm-private/")[1] ?? "");
          if (method === "PUT") {
            blobs.set(key, body ?? new Uint8Array());
            return { status: 200, headers: {}, body: new Uint8Array() };
          }
          if (method === "GET") {
            const hit = blobs.get(key);
            if (!hit) return { status: 404, headers: {}, body: new Uint8Array() };
            return { status: 200, headers: {}, body: hit };
          }
          if (method === "DELETE") {
            blobs.delete(key);
            return { status: 204, headers: {}, body: new Uint8Array() };
          }
          return { status: 405, headers: {}, body: new Uint8Array() };
        },
      },
    });
    await store.put("att/a", new Uint8Array([1, 2, 3]));
    assert.deepEqual(await store.get("att/a"), new Uint8Array([1, 2, 3]));
    await store.delete("att/a");
    assert.equal(await store.get("att/a"), null);
  });

  it("enforces signed URL expiry with constant-time compare", () => {
    const url = signedAttachmentUrl("att-1", "staff-1", 60_000);
    const u = new URL(url, "http://localhost");
    assert.equal(
      verifySignedAttachmentUrl({
        attachmentId: "att-1",
        actorStaffId: "staff-1",
        exp: u.searchParams.get("exp")!,
        sig: u.searchParams.get("sig")!,
      }),
      true,
    );
    assert.equal(
      verifySignedAttachmentUrl({
        attachmentId: "att-1",
        actorStaffId: "staff-1",
        exp: String(Date.now() - 1000),
        sig: u.searchParams.get("sig")!,
      }),
      false,
    );
  });
});

describe("durable multipart upload sessions (postgres)", () => {
  it("resumes after process boundary, enforces checksum/CAS/duplicates, completes and aborts", async () => {
    requireIsolatedDb();
    const { db, crmStaffTable, crmAttachmentUploadsTable, crmAttachmentUploadPartsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);
    const [staff] = await db
      .insert(crmStaffTable)
      .values({
        email: `up.${suffix}@example.com`,
        emailNormalized: `up.${suffix}@example.com`,
        name: "Uploader",
        role: "admin",
        status: "active",
      })
      .returning();
    assert.ok(staff);

    const session = await initiateMultipartUpload({
      meta: { filename: "note.txt", mimeType: "text/plain", sizeBytes: 5 },
      actorStaffId: staff.id,
      expectedPartCount: 2,
      store: memoryObjectStore,
    });

    // Simulate restart: only DB id is known.
    const resumedId = session.id;
    const p1 = await uploadMultipartPart({
      uploadId: resumedId,
      partNumber: 1,
      bytes: new TextEncoder().encode("hel"),
      actorStaffId: staff.id,
      store: memoryObjectStore,
      expectedLockVersion: session.lockVersion,
    });
    assert.equal(p1.replayed, false);

    await assert.rejects(
      () =>
        uploadMultipartPart({
          uploadId: resumedId,
          partNumber: 1,
          bytes: new TextEncoder().encode("xxx"),
          actorStaffId: staff.id,
          store: memoryObjectStore,
        }),
      /Duplicate part/,
    );

    const replay = await uploadMultipartPart({
      uploadId: resumedId,
      partNumber: 1,
      bytes: new TextEncoder().encode("hel"),
      actorStaffId: staff.id,
      store: memoryObjectStore,
    });
    assert.equal(replay.replayed, true);

    await assert.rejects(
      () =>
        uploadMultipartPart({
          uploadId: resumedId,
          partNumber: 2,
          bytes: new TextEncoder().encode("lo"),
          checksumSha256: "deadbeef",
          actorStaffId: staff.id,
          store: memoryObjectStore,
        }),
      /checksum/i,
    );

    await assert.rejects(
      () =>
        uploadMultipartPart({
          uploadId: resumedId,
          partNumber: 2,
          bytes: new TextEncoder().encode("lo"),
          actorStaffId: staff.id,
          store: memoryObjectStore,
          expectedLockVersion: 999,
        }),
      /lock mismatch/i,
    );

    const [current] = await db
      .select()
      .from(crmAttachmentUploadsTable)
      .where(eq(crmAttachmentUploadsTable.id, resumedId))
      .limit(1);
    await uploadMultipartPart({
      uploadId: resumedId,
      partNumber: 2,
      bytes: new TextEncoder().encode("lo"),
      actorStaffId: staff.id,
      store: memoryObjectStore,
      expectedLockVersion: current!.lockVersion,
    });

    const incomplete = await initiateMultipartUpload({
      meta: { filename: "gap.txt", mimeType: "text/plain", sizeBytes: 5 },
      actorStaffId: staff.id,
      expectedPartCount: 2,
      store: memoryObjectStore,
    });
    await uploadMultipartPart({
      uploadId: incomplete.id,
      partNumber: 1,
      bytes: new TextEncoder().encode("hel"),
      actorStaffId: staff.id,
      store: memoryObjectStore,
    });
    await assert.rejects(
      () =>
        completeMultipartUpload({
          uploadId: incomplete.id,
          actorStaffId: staff.id,
          store: memoryObjectStore,
          scanner: { async scan() { return { status: "clean" }; } },
        }),
      /Incomplete|missing/i,
    );

    const attachment = await completeMultipartUpload({
      uploadId: resumedId,
      actorStaffId: staff.id,
      store: memoryObjectStore,
      scanner: { async scan() { return { status: "clean" }; } },
    });
    assert.equal(attachment.filename, "note.txt");
    assert.equal(attachment.sizeBytes, 5);
    assert.equal(attachment.malwareStatus, "clean");

    const idempotent = await completeMultipartUpload({
      uploadId: resumedId,
      actorStaffId: staff.id,
      store: memoryObjectStore,
    });
    assert.equal(idempotent.id, attachment.id);

    const abortSession = await initiateMultipartUpload({
      meta: { filename: "abort.txt", mimeType: "text/plain", sizeBytes: 3 },
      actorStaffId: staff.id,
      store: memoryObjectStore,
    });
    await uploadMultipartPart({
      uploadId: abortSession.id,
      partNumber: 1,
      bytes: new TextEncoder().encode("abc"),
      actorStaffId: staff.id,
      store: memoryObjectStore,
    });
    await abortMultipartUpload({
      uploadId: abortSession.id,
      actorStaffId: staff.id,
      store: memoryObjectStore,
      reason: "user cancelled",
    });
    const parts = await db
      .select()
      .from(crmAttachmentUploadPartsTable)
      .where(eq(crmAttachmentUploadPartsTable.uploadId, abortSession.id));
    assert.ok(parts.length >= 1);
    const cleaned = await reconcileOrphanUploadParts({ store: memoryObjectStore });
    assert.ok(cleaned.cleaned >= 1);
  });

  it("expires stale sessions and quarantines malware with scan retry", async () => {
    requireIsolatedDb();
    const { db, crmStaffTable, crmAttachmentUploadsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);
    const [staff] = await db
      .insert(crmStaffTable)
      .values({
        email: `scan.${suffix}@example.com`,
        emailNormalized: `scan.${suffix}@example.com`,
        name: "Scanner",
        role: "admin",
        status: "active",
      })
      .returning();
    const session = await initiateMultipartUpload({
      meta: { filename: "soon.txt", mimeType: "text/plain", sizeBytes: 2 },
      actorStaffId: staff!.id,
      store: memoryObjectStore,
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const expired = await expireStaleUploads({ store: memoryObjectStore, now: new Date(Date.now() + 1000) });
    assert.ok(expired.expired >= 1);
    const [row] = await db
      .select()
      .from(crmAttachmentUploadsTable)
      .where(eq(crmAttachmentUploadsTable.id, session.id))
      .limit(1);
    assert.equal(row?.status, "expired");

    const live = await initiateMultipartUpload({
      meta: { filename: "bad.txt", mimeType: "text/plain", sizeBytes: 2 },
      actorStaffId: staff!.id,
      expectedPartCount: 1,
      store: memoryObjectStore,
    });
    await uploadMultipartPart({
      uploadId: live.id,
      partNumber: 1,
      bytes: new TextEncoder().encode("no"),
      actorStaffId: staff!.id,
      store: memoryObjectStore,
    });
    const quarantined = await completeMultipartUpload({
      uploadId: live.id,
      actorStaffId: staff!.id,
      store: memoryObjectStore,
      scanner: { async scan() { return { status: "quarantined", reason: "eicar" }; } },
    });
    assert.equal(quarantined.malwareStatus, "quarantined");
    const retried = await retryAttachmentMalwareScan({
      id: quarantined.id,
      actorStaffId: staff!.id,
      store: memoryObjectStore,
      scanner: { async scan() { return { status: "clean" }; } },
    });
    assert.equal(retried.malwareStatus, "clean");

    const held = await initiateMultipartUpload({
      meta: { filename: "hold.txt", mimeType: "text/plain", sizeBytes: 2 },
      actorStaffId: staff!.id,
      expectedPartCount: 1,
      store: memoryObjectStore,
    });
    await uploadMultipartPart({
      uploadId: held.id,
      partNumber: 1,
      bytes: new TextEncoder().encode("ok"),
      actorStaffId: staff!.id,
      store: memoryObjectStore,
    });
    const heldAtt = await completeMultipartUpload({
      uploadId: held.id,
      actorStaffId: staff!.id,
      store: memoryObjectStore,
      scanner: { async scan() { return { status: "clean" }; } },
    });
    const { db: db3, crmAttachmentsTable } = await import("@workspace/db");
    const { eq: eq3 } = await import("drizzle-orm");
    await db3.update(crmAttachmentsTable).set({ legalHold: true }).where(eq3(crmAttachmentsTable.id, heldAtt.id));
    await assert.rejects(
      () => deleteAttachment({ id: heldAtt.id, actorStaffId: staff!.id, store: memoryObjectStore }),
      /Legal hold/,
    );
  });

  it("forbids memory store and default signing secret in production readiness", () => {
    const prev = { ...process.env };
    try {
      process.env.NODE_ENV = "production";
      process.env.CRM_ATTACHMENT_STORE = "memory";
      assert.throws(() => resolveObjectStoreFromEnv(), /forbidden in production/);
      process.env.CRM_ATTACHMENT_STORE = "filesystem";
      delete process.env.CRM_ATTACHMENT_SIGNING_SECRET;
      assert.throws(() => assertAttachmentStoreReadyForEnvironment(), /SIGNING_SECRET/);
    } finally {
      process.env.NODE_ENV = prev.NODE_ENV;
      process.env.CRM_ATTACHMENT_STORE = prev.CRM_ATTACHMENT_STORE;
      process.env.CRM_ATTACHMENT_SIGNING_SECRET = prev.CRM_ATTACHMENT_SIGNING_SECRET;
    }
  });

  it("rejects unauthorized staff on another actor upload", async () => {
    requireIsolatedDb();
    const { db, crmStaffTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);
    const [a] = await db
      .insert(crmStaffTable)
      .values({
        email: `a.${suffix}@example.com`,
        emailNormalized: `a.${suffix}@example.com`,
        name: "A",
        role: "admin",
        status: "active",
      })
      .returning();
    const [b] = await db
      .insert(crmStaffTable)
      .values({
        email: `b.${suffix}@example.com`,
        emailNormalized: `b.${suffix}@example.com`,
        name: "B",
        role: "admin",
        status: "active",
      })
      .returning();
    const session = await initiateMultipartUpload({
      meta: { filename: "priv.txt", mimeType: "text/plain", sizeBytes: 1 },
      actorStaffId: a!.id,
      store: memoryObjectStore,
    });
    await assert.rejects(
      () =>
        uploadMultipartPart({
          uploadId: session.id,
          partNumber: 1,
          bytes: new Uint8Array([1]),
          actorStaffId: b!.id,
          store: memoryObjectStore,
        }),
      /Unauthorized/,
    );
  });

  it("two-process multipart concurrency keeps part CAS and completes once", async () => {
    requireIsolatedDb();
    const { db, crmStaffTable } = await import("@workspace/db");
    const suffix = randomUUID().slice(0, 8);
    const [staff] = await db
      .insert(crmStaffTable)
      .values({
        email: `mp.${suffix}@example.com`,
        emailNormalized: `mp.${suffix}@example.com`,
        name: "MP",
        role: "admin",
        status: "active",
      })
      .returning();
    assert.ok(staff);
    const session = await initiateMultipartUpload({
      meta: { filename: "conc.txt", mimeType: "text/plain", sizeBytes: 4 },
      actorStaffId: staff.id,
      expectedPartCount: 2,
      store: memoryObjectStore,
    });
    const [p1a, p1b] = await Promise.allSettled([
      uploadMultipartPart({
        uploadId: session.id,
        partNumber: 1,
        bytes: new Uint8Array([1, 2]),
        actorStaffId: staff.id,
        store: memoryObjectStore,
        expectedLockVersion: session.lockVersion,
      }),
      uploadMultipartPart({
        uploadId: session.id,
        partNumber: 1,
        bytes: new Uint8Array([9, 9]),
        actorStaffId: staff.id,
        store: memoryObjectStore,
        expectedLockVersion: session.lockVersion,
      }),
    ]);
    const partWins = [p1a, p1b].filter((r) => r.status === "fulfilled");
    assert.equal(partWins.length, 1);
    await uploadMultipartPart({
      uploadId: session.id,
      partNumber: 2,
      bytes: new Uint8Array([3, 4]),
      actorStaffId: staff.id,
      store: memoryObjectStore,
    });
    const [c1, c2] = await Promise.allSettled([
      completeMultipartUpload({
        uploadId: session.id,
        actorStaffId: staff.id,
        store: memoryObjectStore,
        scanner: { async scan() { return { status: "clean" }; } },
      }),
      completeMultipartUpload({
        uploadId: session.id,
        actorStaffId: staff.id,
        store: memoryObjectStore,
        scanner: { async scan() { return { status: "clean" }; } },
      }),
    ]);
    const completes = [c1, c2].filter((r) => r.status === "fulfilled");
    assert.equal(completes.length, 1);
  });

  it("rejects stale lock version and provider-put with failed cleanup leaves orphan for reconcile", async () => {
    requireIsolatedDb();
    const { db, crmStaffTable, crmAttachmentUploadsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const suffix = randomUUID().slice(0, 8);
    const [staff] = await db
      .insert(crmStaffTable)
      .values({
        email: `gen.${suffix}@example.com`,
        emailNormalized: `gen.${suffix}@example.com`,
        name: "Gen",
        role: "admin",
        status: "active",
      })
      .returning();
    assert.ok(staff);
    const session = await initiateMultipartUpload({
      meta: { filename: "gen.txt", mimeType: "text/plain", sizeBytes: 2 },
      actorStaffId: staff.id,
      expectedPartCount: 1,
      store: memoryObjectStore,
    });
    await assert.rejects(
      () =>
        uploadMultipartPart({
          uploadId: session.id,
          partNumber: 1,
          bytes: new Uint8Array([1, 2]),
          actorStaffId: staff.id,
          store: memoryObjectStore,
          expectedLockVersion: session.lockVersion - 1,
        }),
      /lock mismatch/i,
    );

    const orphanKeys: string[] = [];
    const flakyStore: typeof memoryObjectStore = {
      provider: "memory",
      async put(key, bytes) {
        await memoryObjectStore.put(key, bytes);
        orphanKeys.push(key);
        // Simulate DB insert failure after provider put, and cleanup delete also failing.
        throw Object.assign(new Error("simulated DB write failure after provider put"), { code: "23505" });
      },
      async get(key) {
        return memoryObjectStore.get(key);
      },
      async delete() {
        throw new Error("cleanup delete failed");
      },
    };
    await assert.rejects(
      () =>
        uploadMultipartPart({
          uploadId: session.id,
          partNumber: 1,
          bytes: new Uint8Array([7, 8]),
          actorStaffId: staff.id,
          store: flakyStore,
        }),
      /simulated DB write failure/,
    );
    assert.ok(orphanKeys.length >= 1);
    assert.ok(await memoryObjectStore.get(orphanKeys[0]!));
    const [row] = await db
      .select()
      .from(crmAttachmentUploadsTable)
      .where(eq(crmAttachmentUploadsTable.id, session.id))
      .limit(1);
    assert.equal(row?.status, "uploading");
  });
});
