-- Record presence + advisory exclusive edit locking (Priority 5)
-- Optimistic concurrency (lockVersion / expectedUpdatedAt CAS) remains the authoritative
-- conflict guard for writes. These tables are advisory UX signal only: they let the UI
-- show "Currently edited by ..." and steer editors away from collisions before they happen.

CREATE TABLE IF NOT EXISTS "crm_record_locks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL REFERENCES "crm_staff" ("id") ON DELETE CASCADE,
  "intent" text NOT NULL DEFAULT 'edit',
  "lease_expires_at" timestamptz NOT NULL,
  "lock_generation" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_record_locks_entity_type_check"
    CHECK ("entity_type" IN ('inquiry', 'marketing_version', 'config_change'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_record_locks_entity_uniq"
  ON "crm_record_locks" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "crm_record_locks_lease_idx"
  ON "crm_record_locks" ("lease_expires_at");

CREATE TABLE IF NOT EXISTS "crm_record_presence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL REFERENCES "crm_staff" ("id") ON DELETE CASCADE,
  "intent" text NOT NULL DEFAULT 'view',
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_record_presence_entity_type_check"
    CHECK ("entity_type" IN ('inquiry', 'marketing_version', 'config_change'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_record_presence_staff_entity_uniq"
  ON "crm_record_presence" ("staff_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "crm_record_presence_entity_idx"
  ON "crm_record_presence" ("entity_type", "entity_id", "last_seen_at");
