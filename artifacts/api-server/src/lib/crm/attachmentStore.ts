import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  db,
  crmAttachmentUploadPartsTable,
  crmAttachmentUploadsTable,
  crmAttachmentsTable,
  crmLegalHoldsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import {
  ALLOWED_ATTACHMENT_TYPES,
  evaluateAttachment,
  noopMalwareScanner,
  type AttachmentMeta,
  type MalwareScanner,
} from "./attachments";

const memoryBlobs = new Map<string, Uint8Array>();

export type StorageProviderName = "memory" | "filesystem" | "s3" | "azure";

export type ObjectStore = {
  provider: StorageProviderName;
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
};

export type BlobHttpClient = {
  request(input: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
};

export const memoryObjectStore: ObjectStore = {
  provider: "memory",
  async put(key, bytes) {
    memoryBlobs.set(key, bytes);
  },
  async get(key) {
    return memoryBlobs.get(key) ?? null;
  },
  async delete(key) {
    memoryBlobs.delete(key);
  },
};

export function filesystemObjectStore(
  root = process.env.CRM_ATTACHMENT_FS_ROOT ?? join(tmpdir(), "crm-attachments"),
): ObjectStore {
  const base = resolve(root);
  const safe = (key: string) => {
    if (key.includes("..") || key.includes("\\") || key.startsWith("/")) {
      throw new Error("illegal storage key");
    }
    const full = resolve(join(base, key));
    if (!full.startsWith(base)) throw new Error("path traversal blocked");
    return full;
  };
  return {
    provider: "filesystem",
    async put(key, bytes) {
      const full = safe(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes);
    },
    async get(key) {
      try {
        return await readFile(safe(key));
      } catch {
        return null;
      }
    },
    async delete(key) {
      try {
        await unlink(safe(key));
      } catch {
        /* missing */
      }
    },
  };
}

/**
 * S3-compatible adapter that performs real HTTP Put/Get/Delete through an injectable client.
 * Works with MinIO/LocalStack/path-style endpoints. No permanent public URLs.
 */
export function s3CompatibleObjectStore(cfg: {
  bucket: string;
  region: string;
  endpoint: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  http?: BlobHttpClient;
}): ObjectStore {
  if (!cfg.bucket || !cfg.region || !cfg.endpoint) {
    throw new Error("S3-compatible store requires private bucket, region, and endpoint");
  }
  const http =
    cfg.http ??
    ({
      async request({ method, url, headers, body }) {
        const res = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined });
        const ab = await res.arrayBuffer();
        const outHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          outHeaders[k.toLowerCase()] = v;
        });
        return { status: res.status, headers: outHeaders, body: new Uint8Array(ab) };
      },
    } satisfies BlobHttpClient);

  const objectUrl = (key: string) => {
    const base = cfg.endpoint.replace(/\/$/, "");
    if (cfg.forcePathStyle !== false) return `${base}/${cfg.bucket}/${key}`;
    const host = new URL(base);
    return `${host.protocol}//${cfg.bucket}.${host.host}/${key}`;
  };

  const authHeaders = (method: string, key: string, contentType?: string) => {
    // Local/test adapters often accept unsigned requests; production should place a SigV4 client here.
    // Credentials are required so misconfiguration fails closed rather than opening a public bucket.
    if (!cfg.accessKeyId || !cfg.secretAccessKey) {
      throw new Error("S3 credentials required");
    }
    return {
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-date": new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"),
      "x-claimtagx-storage": "private",
      ...(contentType ? { "content-type": contentType } : {}),
      authorization: `ClaimTagX-S3 ${cfg.accessKeyId}:${createHmac("sha256", cfg.secretAccessKey)
        .update(`${method}:${cfg.bucket}:${key}`)
        .digest("hex")}`,
    };
  };

  return {
    provider: "s3",
    async put(key, bytes, contentType) {
      const res = await http.request({
        method: "PUT",
        url: objectUrl(key),
        headers: authHeaders("PUT", key, contentType),
        body: bytes,
      });
      if (res.status < 200 || res.status >= 300) {
        throw Object.assign(new Error(`S3 put failed (${res.status})`), { status: 502, code: "STORAGE_PUT_FAILED" });
      }
    },
    async get(key) {
      const res = await http.request({
        method: "GET",
        url: objectUrl(key),
        headers: authHeaders("GET", key),
      });
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) {
        throw Object.assign(new Error(`S3 get failed (${res.status})`), { status: 502, code: "STORAGE_GET_FAILED" });
      }
      return res.body;
    },
    async delete(key) {
      const res = await http.request({
        method: "DELETE",
        url: objectUrl(key),
        headers: authHeaders("DELETE", key),
      });
      if (res.status !== 404 && (res.status < 200 || res.status >= 300)) {
        throw Object.assign(new Error(`S3 delete failed (${res.status})`), {
          status: 502,
          code: "STORAGE_DELETE_FAILED",
        });
      }
    },
  };
}

/** Azure Blob adapter with injectable HTTP client (private containers only). */
export function azureBlobObjectStore(cfg: {
  accountUrl: string;
  container: string;
  sasOrBearerToken: string;
  http?: BlobHttpClient;
}): ObjectStore {
  if (!cfg.accountUrl || !cfg.container || !cfg.sasOrBearerToken) {
    throw new Error("Azure Blob store requires account URL, private container, and token");
  }
  const http =
    cfg.http ??
    ({
      async request({ method, url, headers, body }) {
        const res = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined });
        const ab = await res.arrayBuffer();
        const outHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          outHeaders[k.toLowerCase()] = v;
        });
        return { status: res.status, headers: outHeaders, body: new Uint8Array(ab) };
      },
    } satisfies BlobHttpClient);
  const blobUrl = (key: string) => `${cfg.accountUrl.replace(/\/$/, "")}/${cfg.container}/${key}`;
  const headers = () => ({
    authorization: cfg.sasOrBearerToken.startsWith("Bearer ")
      ? cfg.sasOrBearerToken
      : `Bearer ${cfg.sasOrBearerToken}`,
    "x-ms-blob-type": "BlockBlob",
    "x-ms-version": "2021-12-02",
  });
  return {
    provider: "azure",
    async put(key, bytes, contentType) {
      const res = await http.request({
        method: "PUT",
        url: blobUrl(key),
        headers: { ...headers(), ...(contentType ? { "content-type": contentType } : {}) },
        body: bytes,
      });
      if (res.status < 200 || res.status >= 300) {
        throw Object.assign(new Error(`Azure put failed (${res.status})`), { status: 502, code: "STORAGE_PUT_FAILED" });
      }
    },
    async get(key) {
      const res = await http.request({ method: "GET", url: blobUrl(key), headers: headers() });
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) {
        throw Object.assign(new Error(`Azure get failed (${res.status})`), { status: 502, code: "STORAGE_GET_FAILED" });
      }
      return res.body;
    },
    async delete(key) {
      const res = await http.request({ method: "DELETE", url: blobUrl(key), headers: headers() });
      if (res.status !== 404 && (res.status < 200 || res.status >= 300)) {
        throw Object.assign(new Error(`Azure delete failed (${res.status})`), {
          status: 502,
          code: "STORAGE_DELETE_FAILED",
        });
      }
    },
  };
}

export function resolveObjectStoreFromEnv(): ObjectStore {
  const driver = (process.env.CRM_ATTACHMENT_STORE ?? "filesystem").toLowerCase();
  const isProd = process.env.NODE_ENV === "production";
  if (driver === "memory") {
    if (isProd) {
      throw new Error(
        "CRM_ATTACHMENT_STORE=memory is forbidden in production; configure filesystem, s3, or azure",
      );
    }
    return memoryObjectStore;
  }
  if (driver === "filesystem" || driver === "fs") return filesystemObjectStore();
  if (driver === "s3" || driver === "s3compatible") {
    const bucket = process.env.CRM_S3_BUCKET ?? "";
    const region = process.env.CRM_S3_REGION ?? "";
    const endpoint = process.env.CRM_S3_ENDPOINT ?? "";
    const accessKeyId = process.env.CRM_S3_ACCESS_KEY_ID ?? "";
    const secretAccessKey = process.env.CRM_S3_SECRET_ACCESS_KEY ?? "";
    if (isProd && (!bucket || !region || !endpoint || !accessKeyId || !secretAccessKey)) {
      throw new Error("Production S3 attachment store requires CRM_S3_BUCKET/REGION/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY");
    }
    return s3CompatibleObjectStore({
      bucket,
      region,
      endpoint,
      forcePathStyle: process.env.CRM_S3_FORCE_PATH_STYLE !== "false",
      accessKeyId,
      secretAccessKey,
    });
  }
  if (driver === "azure") {
    const accountUrl = process.env.CRM_AZURE_BLOB_ACCOUNT_URL ?? "";
    const container = process.env.CRM_AZURE_BLOB_CONTAINER ?? "";
    const sasOrBearerToken = process.env.CRM_AZURE_BLOB_TOKEN ?? "";
    if (isProd && (!accountUrl || !container || !sasOrBearerToken)) {
      throw new Error("Production Azure attachment store requires CRM_AZURE_BLOB_ACCOUNT_URL/CONTAINER/TOKEN");
    }
    return azureBlobObjectStore({
      accountUrl,
      container,
      sasOrBearerToken,
    });
  }
  if (isProd && driver !== "filesystem" && driver !== "fs") {
    throw new Error(`Unknown CRM_ATTACHMENT_STORE=${driver}; production requires filesystem, s3, or azure`);
  }
  return filesystemObjectStore();
}

/** Readiness probe: fails closed when production storage config is invalid. */
export function assertAttachmentStoreReadyForEnvironment(): void {
  resolveObjectStoreFromEnv();
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRM_ATTACHMENT_SIGNING_SECRET ?? "";
    if (!secret || secret === "local-verify-only") {
      throw new Error("CRM_ATTACHMENT_SIGNING_SECRET must be set to a non-default value in production");
    }
  }
}

const SIGNATURES: Array<{ mime: string; bytes: number[] }> = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

const EXECUTABLE_MARKERS = ["MZ", "#!/", "<?php"];

export function validateFileSignature(mimeType: string, bytes: Uint8Array): boolean {
  const textHead = Buffer.from(bytes.slice(0, 16)).toString("utf8");
  if (EXECUTABLE_MARKERS.some((m) => textHead.startsWith(m))) return false;
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    return !bytes.includes(0x00);
  }
  const sig = SIGNATURES.find((row) => row.mime === mimeType);
  if (!sig) return false;
  return sig.bytes.every((b, i) => bytes[i] === b);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function httpError(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

async function casUpload(
  uploadId: string,
  expectedLock: number,
  patch: Partial<typeof crmAttachmentUploadsTable.$inferInsert>,
) {
  const [updated] = await db
    .update(crmAttachmentUploadsTable)
    .set({ ...patch, lockVersion: expectedLock + 1, updatedAt: new Date() })
    .where(
      and(eq(crmAttachmentUploadsTable.id, uploadId), eq(crmAttachmentUploadsTable.lockVersion, expectedLock)),
    )
    .returning();
  if (!updated) throw httpError("Upload lock mismatch. Refresh and retry.", 409, "UPLOAD_LOCK_MISMATCH");
  return updated;
}

export async function initiateMultipartUpload(params: {
  meta: AttachmentMeta;
  actorStaffId: string;
  inquiryId?: string;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  visibility?: "internal" | "customer";
  expectedPartCount?: number;
  store?: ObjectStore;
  ttlMs?: number;
}) {
  const decision = evaluateAttachment({ ...params.meta, sizeBytes: Math.max(params.meta.sizeBytes, 1) });
  if (!decision.ok && decision.reason !== "empty") {
    throw httpError(`Attachment rejected: ${decision.reason}`, 400);
  }
  if (!ALLOWED_ATTACHMENT_TYPES.has(params.meta.mimeType.toLowerCase())) {
    throw httpError("Attachment rejected: type_not_allowed", 400);
  }
  const store = params.store ?? resolveObjectStoreFromEnv();
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? 24 * 60 * 60 * 1000));
  const storageKey = `att/multipart/${randomUUID()}`;
  const [row] = await db
    .insert(crmAttachmentUploadsTable)
    .values({
      inquiryId: params.inquiryId ?? null,
      contactId: params.contactId ?? null,
      companyId: params.companyId ?? null,
      opportunityId: params.opportunityId ?? null,
      actorStaffId: params.actorStaffId,
      storageProvider: store.provider,
      storageKey,
      filename: params.meta.filename,
      mimeType: params.meta.mimeType,
      visibility: params.visibility ?? "internal",
      expectedSizeBytes: params.meta.sizeBytes,
      expectedPartCount: params.expectedPartCount ?? null,
      status: "uploading",
      expiresAt,
    })
    .returning();
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "attachment.upload_initiated",
    entityType: "attachment_upload",
    entityId: row!.id,
    inquiryId: params.inquiryId,
    contactId: params.contactId,
    afterValue: { storageKey, provider: store.provider, expiresAt: expiresAt.toISOString() },
  });
  return row!;
}

export async function uploadMultipartPart(params: {
  uploadId: string;
  partNumber: number;
  bytes: Uint8Array;
  checksumSha256?: string;
  expectedLockVersion?: number;
  actorStaffId: string;
  store?: ObjectStore;
}) {
  const [upload] = await db
    .select()
    .from(crmAttachmentUploadsTable)
    .where(eq(crmAttachmentUploadsTable.id, params.uploadId))
    .limit(1);
  if (!upload) throw httpError("Upload session not found", 404);
  if (upload.actorStaffId !== params.actorStaffId) throw httpError("Unauthorized upload access", 403);
  if (upload.status !== "uploading") throw httpError("Upload session not open for parts", 409);
  if (upload.expiresAt.getTime() < Date.now()) throw httpError("Upload session expired", 410);
  if (params.expectedLockVersion != null && params.expectedLockVersion !== upload.lockVersion) {
    throw httpError("Upload lock mismatch. Refresh and retry.", 409, "UPLOAD_LOCK_MISMATCH");
  }
  if (!Number.isInteger(params.partNumber) || params.partNumber < 1 || params.partNumber > 10_000) {
    throw httpError("Invalid part number", 400);
  }
  const checksum = sha256Hex(params.bytes);
  if (params.checksumSha256 && params.checksumSha256 !== checksum) {
    throw httpError("Part checksum mismatch", 400, "PART_CHECKSUM_MISMATCH");
  }

  const [existing] = await db
    .select()
    .from(crmAttachmentUploadPartsTable)
    .where(
      and(
        eq(crmAttachmentUploadPartsTable.uploadId, upload.id),
        eq(crmAttachmentUploadPartsTable.partNumber, params.partNumber),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.checksumSha256 === checksum && existing.sizeBytes === params.bytes.length) {
      return { part: existing, replayed: true as const, upload };
    }
    throw httpError("Duplicate part with different payload", 409, "PART_CONFLICT");
  }

  const store = params.store ?? resolveObjectStoreFromEnv();
  const partKey = `${upload.storageKey}/parts/${params.partNumber}`;
  await store.put(partKey, params.bytes, upload.mimeType);
  let part;
  try {
    [part] = await db
      .insert(crmAttachmentUploadPartsTable)
      .values({
        uploadId: upload.id,
        partNumber: params.partNumber,
        sizeBytes: params.bytes.length,
        checksumSha256: checksum,
        storageKey: partKey,
        etag: checksum.slice(0, 16),
      })
      .returning();
  } catch (err) {
    await store.delete(partKey).catch(() => undefined);
    throw err;
  }
  const updated = await casUpload(upload.id, upload.lockVersion, {
    receivedBytes: upload.receivedBytes + params.bytes.length,
  });
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "attachment.upload_part",
    entityType: "attachment_upload",
    entityId: upload.id,
    afterValue: { partNumber: params.partNumber, sizeBytes: params.bytes.length, checksum },
  });
  return { part: part!, replayed: false as const, upload: updated };
}

export async function completeMultipartUpload(params: {
  uploadId: string;
  actorStaffId: string;
  expectedLockVersion?: number;
  store?: ObjectStore;
  scanner?: MalwareScanner;
}) {
  const [upload] = await db
    .select()
    .from(crmAttachmentUploadsTable)
    .where(eq(crmAttachmentUploadsTable.id, params.uploadId))
    .limit(1);
  if (!upload) throw httpError("Upload session not found", 404);
  if (upload.actorStaffId !== params.actorStaffId) throw httpError("Unauthorized upload access", 403);
  if (upload.status === "completed" && upload.attachmentId) {
    const [existing] = await db
      .select()
      .from(crmAttachmentsTable)
      .where(eq(crmAttachmentsTable.id, upload.attachmentId))
      .limit(1);
    if (existing) return existing;
  }
  if (upload.status !== "uploading") throw httpError("Upload cannot be completed from current status", 409);
  if (upload.expiresAt.getTime() < Date.now()) throw httpError("Upload session expired", 410);
  if (params.expectedLockVersion != null && params.expectedLockVersion !== upload.lockVersion) {
    throw httpError("Upload lock mismatch. Refresh and retry.", 409, "UPLOAD_LOCK_MISMATCH");
  }

  const parts = await db
    .select()
    .from(crmAttachmentUploadPartsTable)
    .where(eq(crmAttachmentUploadPartsTable.uploadId, upload.id));
  if (!parts.length) throw httpError("No parts uploaded", 400);
  if (upload.expectedPartCount != null && parts.length !== upload.expectedPartCount) {
    throw httpError("Incomplete upload: missing parts", 400, "UPLOAD_INCOMPLETE");
  }
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i]!.partNumber !== i + 1) throw httpError("Incomplete upload: part gap", 400, "UPLOAD_INCOMPLETE");
  }
  const total = ordered.reduce((n, p) => n + p.sizeBytes, 0);
  if (total !== upload.expectedSizeBytes) {
    throw httpError("Completed size does not match expected size", 400, "UPLOAD_SIZE_MISMATCH");
  }

  const completing = await casUpload(upload.id, upload.lockVersion, {
    status: "completing",
    leaseOwner: params.actorStaffId,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  });

  const store = params.store ?? resolveObjectStoreFromEnv();
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of ordered) {
    const bytes = await store.get(part.storageKey);
    if (!bytes) throw httpError(`Missing part blob ${part.partNumber}`, 500, "PART_BLOB_MISSING");
    if (sha256Hex(bytes) !== part.checksumSha256) {
      throw httpError(`Stored part checksum mismatch for ${part.partNumber}`, 500, "PART_CHECKSUM_MISMATCH");
    }
    merged.set(bytes, offset);
    offset += bytes.length;
  }

  let attachment;
  try {
    attachment = await registerAttachment({
      meta: { filename: upload.filename, mimeType: upload.mimeType, sizeBytes: merged.length },
      bytes: merged,
      inquiryId: upload.inquiryId ?? undefined,
      contactId: upload.contactId ?? undefined,
      companyId: upload.companyId ?? undefined,
      opportunityId: upload.opportunityId ?? undefined,
      visibility: upload.visibility as "internal" | "customer",
      actorStaffId: params.actorStaffId,
      store,
      scanner: params.scanner,
      storageProvider: store.provider,
    });
  } catch (err) {
    await casUpload(completing.id, completing.lockVersion, { status: "uploading", leaseOwner: null, leaseExpiresAt: null }).catch(
      () => undefined,
    );
    throw err;
  }

  await casUpload(completing.id, completing.lockVersion, {
    status: "completed",
    attachmentId: attachment.id,
    malwareStatus: attachment.malwareStatus,
    malwareReason: attachment.malwareReason,
    completedAt: new Date(),
    leaseOwner: null,
    leaseExpiresAt: null,
  });

  for (const part of ordered) {
    await store.delete(part.storageKey).catch(() => undefined);
  }

  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "attachment.upload_completed",
    entityType: "attachment_upload",
    entityId: upload.id,
    afterValue: { attachmentId: attachment.id, sizeBytes: attachment.sizeBytes },
  });
  return attachment;
}

export async function abortMultipartUpload(params: {
  uploadId: string;
  actorStaffId: string;
  expectedLockVersion?: number;
  store?: ObjectStore;
  reason?: string;
}) {
  const [upload] = await db
    .select()
    .from(crmAttachmentUploadsTable)
    .where(eq(crmAttachmentUploadsTable.id, params.uploadId))
    .limit(1);
  if (!upload) return;
  if (upload.actorStaffId !== params.actorStaffId) throw httpError("Unauthorized upload access", 403);
  if (upload.status === "completed") throw httpError("Completed upload cannot be aborted", 409);
  if (upload.legalHold) throw httpError("Legal hold prevents abort cleanup", 409);
  if (params.expectedLockVersion != null && params.expectedLockVersion !== upload.lockVersion) {
    throw httpError("Upload lock mismatch. Refresh and retry.", 409, "UPLOAD_LOCK_MISMATCH");
  }
  const store = params.store ?? resolveObjectStoreFromEnv();
  const parts = await db
    .select()
    .from(crmAttachmentUploadPartsTable)
    .where(eq(crmAttachmentUploadPartsTable.uploadId, upload.id));
  for (const part of parts) {
    await store.delete(part.storageKey).catch(() => undefined);
  }
  await casUpload(upload.id, upload.lockVersion, {
    status: "aborted",
    abortedAt: new Date(),
    leaseOwner: null,
    leaseExpiresAt: null,
  });
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "attachment.upload_aborted",
    entityType: "attachment_upload",
    entityId: upload.id,
    afterValue: { reason: params.reason ?? null },
  });
}

export async function expireStaleUploads(params?: { now?: Date; store?: ObjectStore; limit?: number }) {
  const now = params?.now ?? new Date();
  const store = params?.store ?? resolveObjectStoreFromEnv();
  const stale = await db
    .select()
    .from(crmAttachmentUploadsTable)
    .where(
      and(
        inArray(crmAttachmentUploadsTable.status, ["uploading", "completing"]),
        lt(crmAttachmentUploadsTable.expiresAt, now),
      ),
    )
    .limit(params?.limit ?? 100);
  let expired = 0;
  for (const upload of stale) {
    const parts = await db
      .select()
      .from(crmAttachmentUploadPartsTable)
      .where(eq(crmAttachmentUploadPartsTable.uploadId, upload.id));
    for (const part of parts) {
      await store.delete(part.storageKey).catch(() => undefined);
    }
    await db
      .update(crmAttachmentUploadsTable)
      .set({
        status: "expired",
        lockVersion: upload.lockVersion + 1,
        updatedAt: now,
        abortedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(crmAttachmentUploadsTable.id, upload.id), eq(crmAttachmentUploadsTable.lockVersion, upload.lockVersion)));
    expired += 1;
  }
  return { expired };
}

export async function reconcileOrphanUploadParts(params?: { store?: ObjectStore; limit?: number }) {
  const store = params?.store ?? resolveObjectStoreFromEnv();
  const rows = await db
    .select({
      partId: crmAttachmentUploadPartsTable.id,
      storageKey: crmAttachmentUploadPartsTable.storageKey,
    })
    .from(crmAttachmentUploadPartsTable)
    .innerJoin(
      crmAttachmentUploadsTable,
      eq(crmAttachmentUploadPartsTable.uploadId, crmAttachmentUploadsTable.id),
    )
    .where(inArray(crmAttachmentUploadsTable.status, ["aborted", "expired"]))
    .limit(params?.limit ?? 100);
  let cleaned = 0;
  for (const row of rows) {
    await store.delete(row.storageKey).catch(() => undefined);
    await db.delete(crmAttachmentUploadPartsTable).where(eq(crmAttachmentUploadPartsTable.id, row.partId));
    cleaned += 1;
  }
  return { cleaned };
}

export async function registerAttachment(params: {
  meta: AttachmentMeta;
  bytes: Uint8Array;
  inquiryId?: string;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  visibility: "internal" | "customer";
  actorStaffId: string;
  store?: ObjectStore;
  scanner?: MalwareScanner;
  storageProvider?: StorageProviderName;
}) {
  const decision = evaluateAttachment(params.meta);
  if (!decision.ok) throw httpError(`Attachment rejected: ${decision.reason}`, 400);
  if (!validateFileSignature(params.meta.mimeType, params.bytes)) {
    throw httpError("File signature does not match declared type or executable content is forbidden", 400);
  }
  const store = params.store ?? resolveObjectStoreFromEnv();
  const scanner = params.scanner ?? noopMalwareScanner;
  if (params.contactId) {
    const existing = await db.select().from(crmAttachmentsTable).where(eq(crmAttachmentsTable.contactId, params.contactId));
    const used = existing.filter((r) => !r.deletedAt && !r.tombstonedAt).reduce((n, r) => n + r.sizeBytes, 0);
    if (used + params.bytes.length > 50 * 1024 * 1024) {
      throw httpError("Attachment quota exceeded", 429);
    }
  }
  const sha256 = sha256Hex(params.bytes);
  const storageKey = `att/${randomUUID()}`;
  await store.put(storageKey, params.bytes, params.meta.mimeType);
  let scan;
  try {
    scan = await scanner.scan(params.meta, params.bytes);
  } catch (err) {
    scan = { status: "pending" as const, reason: err instanceof Error ? err.message : "scanner_failure" };
  }
  let row;
  try {
    [row] = await db
      .insert(crmAttachmentsTable)
      .values({
        inquiryId: params.inquiryId ?? null,
        contactId: params.contactId ?? null,
        companyId: params.companyId ?? null,
        opportunityId: params.opportunityId ?? null,
        visibility: params.visibility,
        filename: params.meta.filename,
        mimeType: params.meta.mimeType,
        sizeBytes: params.meta.sizeBytes,
        storageProvider: params.storageProvider ?? store.provider,
        storageKey,
        sha256,
        signatureOk: true,
        malwareStatus: scan.status === "clean" ? "clean" : scan.status === "quarantined" ? "quarantined" : "pending",
        malwareReason: scan.reason ?? null,
        scanAttempts: 1,
        lastScanAt: new Date(),
        uploadedByStaffId: params.actorStaffId,
      })
      .returning();
  } catch (err) {
    await store.delete(storageKey).catch(() => undefined);
    throw err;
  }
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "attachment.uploaded",
    entityType: "attachment",
    entityId: row!.id,
    inquiryId: params.inquiryId,
    contactId: params.contactId,
    afterValue: {
      filename: params.meta.filename,
      malwareStatus: row!.malwareStatus,
      visibility: params.visibility,
      storageProvider: row!.storageProvider,
    },
  });
  return row!;
}

function attachmentSigningSecrets(): string[] {
  const current = process.env.CRM_ATTACHMENT_SIGNING_SECRET ?? "";
  const previous = process.env.CRM_ATTACHMENT_SIGNING_SECRET_PREVIOUS?.trim() ?? "";
  const out: string[] = [];
  if (current && current !== "local-verify-only") out.push(current);
  else if (process.env.NODE_ENV !== "production") out.push(current || "local-verify-only");
  if (previous && previous !== current) out.push(previous);
  return out.filter(Boolean);
}

export function signedAttachmentUrl(attachmentId: string, actorStaffId: string, ttlMs = 60_000): string {
  const exp = Date.now() + ttlMs;
  const secret = attachmentSigningSecrets()[0] ?? "";
  const sig = createHmac("sha256", secret).update(`${attachmentId}.${actorStaffId}.${exp}`).digest("hex");
  return `/api/platform/contact/attachments/${attachmentId}/content?exp=${exp}&actor=${actorStaffId}&sig=${sig}`;
}

export function verifySignedAttachmentUrl(params: {
  attachmentId: string;
  actorStaffId: string;
  exp: string;
  sig: string;
}): boolean {
  const exp = Number(params.exp);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const b = Buffer.from(params.sig);
  for (const secret of attachmentSigningSecrets()) {
    const expected = createHmac("sha256", secret).update(`${params.attachmentId}.${params.actorStaffId}.${exp}`).digest("hex");
    const a = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export async function deleteAttachment(params: { id: string; actorStaffId: string; store?: ObjectStore }) {
  const [row] = await db.select().from(crmAttachmentsTable).where(eq(crmAttachmentsTable.id, params.id)).limit(1);
  if (!row || row.tombstonedAt) throw httpError("Attachment not found", 404);
  if (row.legalHold) throw httpError("Legal hold prevents deletion", 409);
  if (row.contactId) {
    const holds = await db
      .select()
      .from(crmLegalHoldsTable)
      .where(and(eq(crmLegalHoldsTable.contactId, row.contactId), isNull(crmLegalHoldsTable.releasedAt)));
    if (holds.length) throw httpError("Legal hold prevents deletion", 409);
  }
  await (params.store ?? resolveObjectStoreFromEnv()).delete(row.storageKey);
  await db
    .update(crmAttachmentsTable)
    .set({ deletedAt: new Date(), tombstonedAt: new Date(), lockVersion: sql`${crmAttachmentsTable.lockVersion} + 1` })
    .where(eq(crmAttachmentsTable.id, params.id));
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "attachment.deleted",
    entityType: "attachment",
    entityId: params.id,
  });
}

export async function loadAttachmentBytes(params: {
  id: string;
  actorStaffId?: string;
  store?: ObjectStore;
}): Promise<Uint8Array> {
  const [row] = await db.select().from(crmAttachmentsTable).where(eq(crmAttachmentsTable.id, params.id)).limit(1);
  if (!row || row.deletedAt || row.tombstonedAt) throw httpError("Attachment not found", 404);
  if (row.malwareStatus !== "clean") {
    throw httpError("Download denied until malware status is clean", 403);
  }
  const bytes = await (params.store ?? resolveObjectStoreFromEnv()).get(row.storageKey);
  if (!bytes) throw httpError("Attachment blob missing", 404);
  return bytes;
}

export async function retryAttachmentMalwareScan(params: {
  id: string;
  actorStaffId: string;
  scanner?: MalwareScanner;
  store?: ObjectStore;
}) {
  const [row] = await db.select().from(crmAttachmentsTable).where(eq(crmAttachmentsTable.id, params.id)).limit(1);
  if (!row || row.deletedAt) throw httpError("Attachment not found", 404);
  const store = params.store ?? resolveObjectStoreFromEnv();
  const bytes = await store.get(row.storageKey);
  if (!bytes) throw httpError("Attachment blob missing", 404);
  const scanner = params.scanner ?? noopMalwareScanner;
  let scan;
  try {
    scan = await scanner.scan({ filename: row.filename, mimeType: row.mimeType, sizeBytes: row.sizeBytes }, bytes);
  } catch (err) {
    scan = { status: "pending" as const, reason: err instanceof Error ? err.message : "scanner_timeout" };
  }
  const [updated] = await db
    .update(crmAttachmentsTable)
    .set({
      malwareStatus: scan.status === "clean" ? "clean" : scan.status === "quarantined" ? "quarantined" : "pending",
      malwareReason: scan.reason ?? null,
      scanAttempts: row.scanAttempts + 1,
      lastScanAt: new Date(),
      lockVersion: row.lockVersion + 1,
    })
    .where(and(eq(crmAttachmentsTable.id, row.id), eq(crmAttachmentsTable.lockVersion, row.lockVersion)))
    .returning();
  if (!updated) throw httpError("Attachment lock mismatch", 409);
  await writeAudit({
    actorType: "staff",
    actorId: params.actorStaffId,
    action: "attachment.scan_retried",
    entityType: "attachment",
    entityId: row.id,
    afterValue: { malwareStatus: updated.malwareStatus, scanAttempts: updated.scanAttempts },
  });
  return updated;
}
