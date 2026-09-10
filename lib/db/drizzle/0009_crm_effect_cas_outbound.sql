-- Effect claim generation, outbound send ledger, opportunity lifecycle fields
ALTER TABLE "crm_job_effects"
  ADD COLUMN IF NOT EXISTS "claim_generation" integer NOT NULL DEFAULT 0;

ALTER TABLE "crm_opportunities"
  ADD COLUMN IF NOT EXISTS "probability" integer,
  ADD COLUMN IF NOT EXISTS "expected_close_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "lost_reason" text,
  ADD COLUMN IF NOT EXISTS "team_id" uuid;

DO $$
BEGIN
  ALTER TABLE "crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_team_fk"
    FOREIGN KEY ("team_id") REFERENCES "crm_teams"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "crm_outbound_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "logical_intent_id" text NOT NULL,
  "effect_key" text NOT NULL,
  "inquiry_id" uuid,
  "template_key" text,
  "template_version_id" uuid,
  "provider_idempotency_key" text NOT NULL,
  "provider_request_id" text,
  "provider_message_id" text,
  "recipient_hash" text,
  "content_hash" text,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "crm_message_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "accepted_at" timestamptz,
  "committed_at" timestamptz,
  "reconciled_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_outbound_sends_intent_uidx" ON "crm_outbound_sends" ("logical_intent_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_outbound_sends_provider_key_uidx" ON "crm_outbound_sends" ("provider_idempotency_key");
CREATE INDEX IF NOT EXISTS "crm_outbound_sends_effect_idx" ON "crm_outbound_sends" ("effect_key");

ALTER TABLE "crm_schema_migrations"
  ADD COLUMN IF NOT EXISTS "fingerprint" text;
