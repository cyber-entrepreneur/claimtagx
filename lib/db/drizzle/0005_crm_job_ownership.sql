-- ClaimTagX Contact CRM: job claim generation, idempotency, audit immutability, merge history
-- Apply via psql onto an isolated database only.

ALTER TABLE "crm_jobs"
  ADD COLUMN IF NOT EXISTS "claim_generation" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "crm_jobs_idempotency_uidx"
  ON "crm_jobs" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "crm_jobs_recurring_active_uidx"
  ON "crm_jobs" ("type")
  WHERE "type" IN ('refresh_sla', 'enforce_retention')
    AND "status" IN ('pending', 'running');

ALTER TABLE "crm_config_changes"
  ADD COLUMN IF NOT EXISTS "lock_version" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "crm_webhook_receipts" (
  "provider_event_id" text PRIMARY KEY NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "crm_contact_merges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "winner_id" uuid NOT NULL REFERENCES "crm_contacts"("id") ON DELETE RESTRICT,
  "loser_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "plan" jsonb NOT NULL,
  "actor_staff_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_contact_merges_idempotency_uidx"
  ON "crm_contact_merges" ("idempotency_key");

CREATE OR REPLACE FUNCTION crm_audit_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'crm_audit_events is insert-only';
END;
$$;

DROP TRIGGER IF EXISTS crm_audit_events_no_update ON crm_audit_events;
DROP TRIGGER IF EXISTS crm_audit_events_no_delete ON crm_audit_events;

CREATE TRIGGER crm_audit_events_no_update
  BEFORE UPDATE ON crm_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION crm_audit_events_immutable();

CREATE TRIGGER crm_audit_events_no_delete
  BEFORE DELETE ON crm_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION crm_audit_events_immutable();
