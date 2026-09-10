-- ClaimTagX Contact CRM: durable jobs + distributed rate limits + inquiry type
-- Apply via: pnpm --filter @workspace/db run migrate
-- or drizzle-kit push during transition.

ALTER TABLE "crm_inquiries"
  ADD COLUMN IF NOT EXISTS "inquiry_type" text NOT NULL DEFAULT 'sales';

ALTER TABLE "crm_jobs"
  ADD COLUMN IF NOT EXISTS "causation_id" text,
  ADD COLUMN IF NOT EXISTS "locked_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "locked_by" text,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamptz;

CREATE INDEX IF NOT EXISTS "crm_jobs_lease_idx"
  ON "crm_jobs" ("status", "lease_expires_at");

CREATE TABLE IF NOT EXISTS "crm_rate_limits" (
  "bucket_key" text PRIMARY KEY NOT NULL,
  "window_started_at" timestamptz NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "crm_rate_limits_window_idx"
  ON "crm_rate_limits" ("window_started_at");
