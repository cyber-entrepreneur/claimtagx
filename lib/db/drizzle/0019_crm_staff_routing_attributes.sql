ALTER TABLE crm_staff
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS languages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS specialties jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS capacity_limit integer,
  ADD COLUMN IF NOT EXISTS ooo_until timestamptz,
  ADD COLUMN IF NOT EXISTS ooo_reason text;

COMMENT ON COLUMN crm_staff.capacity_limit IS 'Max open assigned inquiries; null = unlimited';
COMMENT ON COLUMN crm_staff.ooo_until IS 'Out-of-office until this instant (UTC)';
COMMENT ON COLUMN crm_staff.languages IS 'JSON array of BCP-47 language tags staff can handle';
COMMENT ON COLUMN crm_staff.specialties IS 'JSON array of inquiry specialization keys';
