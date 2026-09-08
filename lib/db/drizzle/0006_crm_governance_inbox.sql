-- ClaimTagX Contact CRM: publication lineage, webhook inbox, merge lock metadata
-- Apply via psql onto an isolated database only.

ALTER TABLE "crm_webhook_receipts"
  ADD COLUMN IF NOT EXISTS "payload_hash" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "processed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

ALTER TABLE "crm_config_changes"
  ADD COLUMN IF NOT EXISTS "published_version" integer,
  ADD COLUMN IF NOT EXISTS "rollback_of_id" uuid,
  ADD COLUMN IF NOT EXISTS "supersedes_id" uuid,
  ADD COLUMN IF NOT EXISTS "emergency" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "emergency_reason" text,
  ADD COLUMN IF NOT EXISTS "schema_version" integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "crm_config_publications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "published_version" integer NOT NULL,
  "change_id" uuid NOT NULL REFERENCES "crm_config_changes"("id") ON DELETE RESTRICT,
  "supersedes_id" uuid,
  "rollback_of_id" uuid,
  "before_value" jsonb,
  "after_value" jsonb NOT NULL,
  "author_staff_id" text,
  "reviewer_staff_id" text,
  "publisher_staff_id" text,
  "emergency" boolean NOT NULL DEFAULT false,
  "emergency_reason" text,
  "schema_version" integer NOT NULL DEFAULT 1,
  "published_at" timestamptz NOT NULL DEFAULT now(),
  "effective_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_config_publications_stream_version_uidx"
  ON "crm_config_publications" ("entity_type", "entity_id", "published_version");

CREATE INDEX IF NOT EXISTS "crm_config_publications_stream_idx"
  ON "crm_config_publications" ("entity_type", "entity_id", "published_at");

CREATE OR REPLACE FUNCTION crm_config_publications_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'crm_config_publications is insert-only';
END;
$$;

DROP TRIGGER IF EXISTS crm_config_publications_no_update ON crm_config_publications;
DROP TRIGGER IF EXISTS crm_config_publications_no_delete ON crm_config_publications;

CREATE TRIGGER crm_config_publications_no_update
  BEFORE UPDATE ON crm_config_publications
  FOR EACH ROW
  EXECUTE FUNCTION crm_config_publications_immutable();

CREATE TRIGGER crm_config_publications_no_delete
  BEFORE DELETE ON crm_config_publications
  FOR EACH ROW
  EXECUTE FUNCTION crm_config_publications_immutable();
