-- Durable operational CRM export jobs (inbox CSV; not a warehouse pipeline)

CREATE TABLE IF NOT EXISTS "crm_export_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id" uuid NOT NULL REFERENCES "crm_staff" ("id") ON DELETE CASCADE,
  "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "columns" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "artifact_path" text,
  "error" text,
  "row_count" integer,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_export_jobs_status_check"
    CHECK ("status" IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS "crm_export_jobs_staff_created_idx"
  ON "crm_export_jobs" ("staff_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "crm_export_jobs_status_idx"
  ON "crm_export_jobs" ("status", "created_at");
