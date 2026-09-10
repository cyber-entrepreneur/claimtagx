-- ClaimTagX Contact CRM: durable effect lifecycle, webhook payload, DSAR, attachments, opportunities
-- Apply via applyCrmMigrations() / pnpm --filter @workspace/db run migrate:crm
-- Never use drizzle-kit push --force as a production bootstrap.

ALTER TABLE "crm_job_effects"
  ADD COLUMN IF NOT EXISTS "job_claim_generation" integer,
  ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "processing_token" text,
  ADD COLUMN IF NOT EXISTS "processing_owner" text,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "payload_hash" text,
  ADD COLUMN IF NOT EXISTS "provider_idempotency_key" text,
  ADD COLUMN IF NOT EXISTS "provider_request_id" text,
  ADD COLUMN IF NOT EXISTS "correlation_id" text,
  ADD COLUMN IF NOT EXISTS "causation_id" text,
  ADD COLUMN IF NOT EXISTS "started_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "committed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "failed_at" timestamptz;

ALTER TABLE "crm_job_effects" ALTER COLUMN "status" SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS "crm_job_effects_status_idx" ON "crm_job_effects" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "crm_job_effects_job_idx" ON "crm_job_effects" ("job_id");

ALTER TABLE "crm_webhook_receipts"
  ADD COLUMN IF NOT EXISTS "raw_payload" text,
  ADD COLUMN IF NOT EXISTS "payload_encrypted" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "normalized_payload" jsonb,
  ADD COLUMN IF NOT EXISTS "retained_until" timestamptz;

CREATE TABLE IF NOT EXISTS "crm_schema_migrations" (
  "filename" text PRIMARY KEY NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "applied_by" text
);

CREATE TABLE IF NOT EXISTS "crm_dsar_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid REFERENCES "crm_contacts"("id") ON DELETE RESTRICT,
  "company_id" uuid REFERENCES "crm_companies"("id") ON DELETE SET NULL,
  "request_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'intake',
  "identity_verified_at" timestamptz,
  "due_at" timestamptz,
  "owner_staff_id" uuid REFERENCES "crm_staff"("id") ON DELETE SET NULL,
  "legal_exception_reason" text,
  "rejection_reason" text,
  "export_manifest" jsonb,
  "notes" text,
  "created_by_staff_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "crm_dsar_requests_type_chk" CHECK ("request_type" IN (
    'access', 'export', 'correction', 'deletion', 'objection'
  )),
  CONSTRAINT "crm_dsar_requests_status_chk" CHECK ("status" IN (
    'intake', 'identity_pending', 'identity_verified', 'in_progress',
    'legal_review', 'completed', 'rejected'
  ))
);

CREATE INDEX IF NOT EXISTS "crm_dsar_contact_idx" ON "crm_dsar_requests" ("contact_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_dsar_status_idx" ON "crm_dsar_requests" ("status", "due_at");

CREATE TABLE IF NOT EXISTS "crm_opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inquiry_id" uuid REFERENCES "crm_inquiries"("id") ON DELETE RESTRICT,
  "contact_id" uuid NOT NULL REFERENCES "crm_contacts"("id") ON DELETE RESTRICT,
  "company_id" uuid REFERENCES "crm_companies"("id") ON DELETE SET NULL,
  "stage" text NOT NULL DEFAULT 'new',
  "amount_cents" integer,
  "currency" text NOT NULL DEFAULT 'USD',
  "owner_staff_id" uuid REFERENCES "crm_staff"("id") ON DELETE SET NULL,
  "source" text,
  "conversion_idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "converted_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_opportunities_inquiry_uidx" ON "crm_opportunities" ("inquiry_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_opportunities_conversion_uidx" ON "crm_opportunities" ("conversion_idempotency_key");
CREATE INDEX IF NOT EXISTS "crm_opportunities_contact_idx" ON "crm_opportunities" ("contact_id");

CREATE TABLE IF NOT EXISTS "crm_opportunity_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL REFERENCES "crm_opportunities"("id") ON DELETE CASCADE,
  "from_stage" text,
  "to_stage" text NOT NULL,
  "actor_staff_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "crm_opportunity_stages_opp_idx" ON "crm_opportunity_stages" ("opportunity_id", "created_at");

CREATE TABLE IF NOT EXISTS "crm_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inquiry_id" uuid REFERENCES "crm_inquiries"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
  "company_id" uuid REFERENCES "crm_companies"("id") ON DELETE SET NULL,
  "opportunity_id" uuid REFERENCES "crm_opportunities"("id") ON DELETE SET NULL,
  "visibility" text NOT NULL DEFAULT 'internal',
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" text NOT NULL,
  "sha256" text NOT NULL,
  "signature_ok" boolean NOT NULL DEFAULT false,
  "malware_status" text NOT NULL DEFAULT 'pending',
  "malware_reason" text,
  "legal_hold" boolean NOT NULL DEFAULT false,
  "uploaded_by_staff_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "crm_attachments_visibility_chk" CHECK ("visibility" IN ('internal', 'customer')),
  CONSTRAINT "crm_attachments_malware_chk" CHECK ("malware_status" IN ('pending', 'clean', 'quarantined', 'rejected'))
);

CREATE INDEX IF NOT EXISTS "crm_attachments_inquiry_idx" ON "crm_attachments" ("inquiry_id");
CREATE INDEX IF NOT EXISTS "crm_attachments_contact_idx" ON "crm_attachments" ("contact_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_attachments_storage_uidx" ON "crm_attachments" ("storage_key");
