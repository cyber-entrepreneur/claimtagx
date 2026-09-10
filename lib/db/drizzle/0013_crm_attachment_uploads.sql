-- Durable multipart attachment upload sessions (restart-safe, multi-instance)

CREATE TABLE IF NOT EXISTS "crm_attachment_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "inquiry_id" uuid REFERENCES "crm_inquiries" ("id") ON DELETE SET NULL,
  "contact_id" uuid REFERENCES "crm_contacts" ("id") ON DELETE SET NULL,
  "company_id" uuid REFERENCES "crm_companies" ("id") ON DELETE SET NULL,
  "opportunity_id" uuid,
  "attachment_id" uuid REFERENCES "crm_attachments" ("id") ON DELETE SET NULL,
  "actor_staff_id" text NOT NULL,
  "storage_provider" text NOT NULL DEFAULT 'filesystem',
  "storage_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "visibility" text NOT NULL DEFAULT 'internal',
  "expected_size_bytes" bigint NOT NULL,
  "expected_part_count" integer,
  "received_bytes" bigint NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'uploading',
  "malware_status" text NOT NULL DEFAULT 'pending',
  "malware_reason" text,
  "lock_version" integer NOT NULL DEFAULT 1,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "legal_hold" boolean NOT NULL DEFAULT false,
  "retention_until" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "aborted_at" timestamptz,
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_attachment_uploads_storage_uidx"
  ON "crm_attachment_uploads" ("storage_key");

CREATE INDEX IF NOT EXISTS "crm_attachment_uploads_status_idx"
  ON "crm_attachment_uploads" ("status", "expires_at");

CREATE INDEX IF NOT EXISTS "crm_attachment_uploads_actor_idx"
  ON "crm_attachment_uploads" ("actor_staff_id", "created_at");

CREATE TABLE IF NOT EXISTS "crm_attachment_upload_parts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "upload_id" uuid NOT NULL REFERENCES "crm_attachment_uploads" ("id") ON DELETE CASCADE,
  "part_number" integer NOT NULL,
  "size_bytes" integer NOT NULL,
  "checksum_sha256" text NOT NULL,
  "storage_key" text NOT NULL,
  "etag" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_attachment_upload_parts_uniq"
  ON "crm_attachment_upload_parts" ("upload_id", "part_number");

CREATE UNIQUE INDEX IF NOT EXISTS "crm_attachment_upload_parts_storage_uidx"
  ON "crm_attachment_upload_parts" ("storage_key");

ALTER TABLE "crm_attachments"
  ADD COLUMN IF NOT EXISTS "storage_provider" text NOT NULL DEFAULT 'filesystem',
  ADD COLUMN IF NOT EXISTS "tombstoned_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "lock_version" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "scan_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_scan_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "retention_until" timestamptz;
