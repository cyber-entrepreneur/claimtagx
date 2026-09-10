-- ClaimTagX Contact CRM: RFC email threading + delivery metadata
-- Apply via: pnpm --filter @workspace/db run migrate
-- Additive only; existing rows stay valid (new columns are nullable).

ALTER TABLE "crm_messages"
  ADD COLUMN IF NOT EXISTS "text_body" text,
  ADD COLUMN IF NOT EXISTS "sanitized_html" text,
  ADD COLUMN IF NOT EXISTS "message_id" text,
  ADD COLUMN IF NOT EXISTS "references_header" text,
  ADD COLUMN IF NOT EXISTS "provider_message_id" text,
  ADD COLUMN IF NOT EXISTS "provider_event_id" text,
  ADD COLUMN IF NOT EXISTS "delivery_status" text,
  ADD COLUMN IF NOT EXISTS "bounce_type" text,
  ADD COLUMN IF NOT EXISTS "complaint_type" text;

CREATE UNIQUE INDEX IF NOT EXISTS "crm_messages_message_id_uniq"
  ON "crm_messages" ("message_id");

CREATE UNIQUE INDEX IF NOT EXISTS "crm_messages_provider_event_id_uniq"
  ON "crm_messages" ("provider_event_id");

CREATE INDEX IF NOT EXISTS "crm_messages_provider_message_idx"
  ON "crm_messages" ("provider_message_id");
