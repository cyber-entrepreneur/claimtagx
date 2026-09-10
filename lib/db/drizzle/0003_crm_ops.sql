-- ClaimTagX Contact CRM: SLA pause, legal hold, quarantine, staff invites, saved-view defaults
-- Apply via: pnpm --filter @workspace/db run migrate
-- Additive; older binaries ignore unknown columns.

ALTER TABLE "crm_sla_instances"
  ADD COLUMN IF NOT EXISTS "paused_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "remaining_ms" integer;

ALTER TABLE "crm_saved_views"
  ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS "crm_companies_name_uniq"
  ON "crm_companies" ("name_normalized");

CREATE TABLE IF NOT EXISTS "crm_legal_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid REFERENCES "crm_contacts"("id") ON DELETE CASCADE,
  "inquiry_id" uuid REFERENCES "crm_inquiries"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "created_by" uuid REFERENCES "crm_staff"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "released_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "crm_legal_holds_contact_idx"
  ON "crm_legal_holds" ("contact_id", "released_at");
CREATE INDEX IF NOT EXISTS "crm_legal_holds_inquiry_idx"
  ON "crm_legal_holds" ("inquiry_id", "released_at");

CREATE TABLE IF NOT EXISTS "crm_email_quarantine" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reason" text NOT NULL,
  "subject" text,
  "message_id" text,
  "in_reply_to" text,
  "payload" jsonb,
  "status" text NOT NULL DEFAULT 'open',
  "reconciled_inquiry_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "crm_email_quarantine_status_idx"
  ON "crm_email_quarantine" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "crm_session_revocations" (
  "staff_id" uuid PRIMARY KEY NOT NULL REFERENCES "crm_staff"("id") ON DELETE CASCADE,
  "revoked_before" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "crm_staff_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email_normalized" text NOT NULL,
  "role" text NOT NULL DEFAULT 'sales',
  "invited_by" uuid REFERENCES "crm_staff"("id"),
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_staff_invites_email_uniq"
  ON "crm_staff_invites" ("email_normalized");
