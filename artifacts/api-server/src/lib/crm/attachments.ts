export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
]);

export type AttachmentMeta = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type AttachmentDecision =
  | { ok: true; meta: AttachmentMeta }
  | { ok: false; reason: "too_large" | "type_not_allowed" | "empty" | "invalid_name" };

export function evaluateAttachment(meta: AttachmentMeta): AttachmentDecision {
  const filename = meta.filename.trim();
  if (!filename || filename.length > 200 || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return { ok: false, reason: "invalid_name" };
  }
  if (meta.sizeBytes <= 0) return { ok: false, reason: "empty" };
  if (meta.sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "too_large" };
  if (!ALLOWED_ATTACHMENT_TYPES.has(meta.mimeType.toLowerCase())) {
    return { ok: false, reason: "type_not_allowed" };
  }
  return { ok: true, meta: { ...meta, filename } };
}

export type MalwareScanResult = { status: "clean" | "quarantined" | "pending"; reason?: string };

export type MalwareScanner = {
  scan(meta: AttachmentMeta, bytes?: Uint8Array): Promise<MalwareScanResult>;
};

/** Default adapter: metadata-only. Wire a real scanner in production via CRM_MALWARE_SCANNER. */
export const noopMalwareScanner: MalwareScanner = {
  async scan() {
    return { status: "pending" };
  },
};
