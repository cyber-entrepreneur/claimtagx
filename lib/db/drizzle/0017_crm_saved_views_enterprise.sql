-- Enterprise saved views: team/shared scope, versioning, transfer metadata

ALTER TABLE "crm_saved_views"
  ADD COLUMN IF NOT EXISTS "team_id" uuid REFERENCES "crm_teams" ("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_by" uuid REFERENCES "crm_staff" ("id") ON DELETE SET NULL;

ALTER TABLE "crm_saved_views"
  DROP CONSTRAINT IF EXISTS "crm_saved_views_scope_check";

ALTER TABLE "crm_saved_views"
  ADD CONSTRAINT "crm_saved_views_scope_check"
  CHECK ("scope" IN ('personal', 'team', 'shared'));

CREATE INDEX IF NOT EXISTS "crm_saved_views_scope_team_idx"
  ON "crm_saved_views" ("scope", "team_id");

CREATE INDEX IF NOT EXISTS "crm_saved_views_staff_default_idx"
  ON "crm_saved_views" ("staff_id", "is_default");

-- Inquiry list search support (reference / type / status / priority / owner / updated)
CREATE INDEX IF NOT EXISTS "crm_inquiries_reference_idx"
  ON "crm_inquiries" ("reference");

CREATE INDEX IF NOT EXISTS "crm_inquiries_status_priority_idx"
  ON "crm_inquiries" ("status", "priority", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "crm_inquiries_owner_updated_idx"
  ON "crm_inquiries" ("assigned_staff_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "crm_inquiries_type_created_idx"
  ON "crm_inquiries" ("inquiry_type", "created_at" DESC);
