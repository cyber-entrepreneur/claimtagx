-- Config change control + SLA calendar fields
-- Apply via: psql "$DATABASE_URL" -f lib/db/drizzle/0004_crm_config_changes.sql

ALTER TABLE "crm_sla_policies"
  ADD COLUMN IF NOT EXISTS "holidays" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "time_zone" text NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS "crm_config_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "summary" text,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "before_value" jsonb,
  "after_value" jsonb NOT NULL,
  "author_staff_id" uuid REFERENCES "crm_staff"("id"),
  "reviewer_staff_id" uuid REFERENCES "crm_staff"("id"),
  "publisher_staff_id" uuid REFERENCES "crm_staff"("id"),
  "effective_at" timestamptz,
  "published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "crm_config_changes_entity_idx"
  ON "crm_config_changes" ("entity_type", "entity_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_config_changes_status_idx"
  ON "crm_config_changes" ("status", "created_at");
