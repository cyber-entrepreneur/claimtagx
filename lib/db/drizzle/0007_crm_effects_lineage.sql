-- ClaimTagX Contact CRM: job effects, webhook receipt ownership, publication FKs
-- Apply via psql onto an isolated database only.

CREATE TABLE IF NOT EXISTS "crm_job_effects" (
  "idempotency_key" text PRIMARY KEY NOT NULL,
  "job_id" uuid,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'committed',
  "provider_message_id" text,
  "meta" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "crm_job_effects_kind_idx" ON "crm_job_effects" ("kind", "created_at");

ALTER TABLE "crm_webhook_receipts"
  ADD COLUMN IF NOT EXISTS "claim_generation" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "processing_token" text,
  ADD COLUMN IF NOT EXISTS "processing_owner" text,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "terminal" boolean NOT NULL DEFAULT false;

ALTER TABLE "crm_config_changes"
  ADD COLUMN IF NOT EXISTS "rollback_of_publication_id" uuid,
  ADD COLUMN IF NOT EXISTS "supersedes_change_id" uuid;

ALTER TABLE "crm_config_publications" DISABLE TRIGGER crm_config_publications_no_update;
UPDATE "crm_config_publications" p
SET "rollback_of_id" = NULL
WHERE p."rollback_of_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "crm_config_publications" x WHERE x."id" = p."rollback_of_id");
UPDATE "crm_config_publications" p
SET "supersedes_id" = NULL
WHERE p."supersedes_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "crm_config_publications" x WHERE x."id" = p."supersedes_id");
ALTER TABLE "crm_config_publications" ENABLE TRIGGER crm_config_publications_no_update;

DO $$
BEGIN
  ALTER TABLE "crm_config_publications"
    ADD CONSTRAINT "crm_config_publications_supersedes_fk"
    FOREIGN KEY ("supersedes_id") REFERENCES "crm_config_publications"("id") ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "crm_config_publications"
    ADD CONSTRAINT "crm_config_publications_rollback_fk"
    FOREIGN KEY ("rollback_of_id") REFERENCES "crm_config_publications"("id") ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "crm_config_changes"
    ADD CONSTRAINT "crm_config_changes_rollback_pub_fk"
    FOREIGN KEY ("rollback_of_publication_id") REFERENCES "crm_config_publications"("id") ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "crm_config_changes"
    ADD CONSTRAINT "crm_config_changes_supersedes_change_fk"
    FOREIGN KEY ("supersedes_change_id") REFERENCES "crm_config_changes"("id") ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "crm_job_effects"
    ADD CONSTRAINT "crm_job_effects_job_fk"
    FOREIGN KEY ("job_id") REFERENCES "crm_jobs"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION crm_config_publications_lineage_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM crm_config_publications p
      WHERE p.id = NEW.supersedes_id
        AND p.entity_type = NEW.entity_type
        AND p.entity_id = NEW.entity_id
    ) THEN
      RAISE EXCEPTION 'cross-stream supersedes_id is not allowed';
    END IF;
  END IF;
  IF NEW.rollback_of_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM crm_config_publications p
      WHERE p.id = NEW.rollback_of_id
        AND p.entity_type = NEW.entity_type
        AND p.entity_id = NEW.entity_id
    ) THEN
      RAISE EXCEPTION 'cross-stream rollback_of_id is not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_config_publications_lineage_guard ON crm_config_publications;
CREATE TRIGGER crm_config_publications_lineage_guard
  BEFORE INSERT ON crm_config_publications
  FOR EACH ROW EXECUTE FUNCTION crm_config_publications_lineage_guard();

