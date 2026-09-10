-- ClaimTagX first-party auth: remove hosted-IdP identity from the CURRENT schema.
-- Additive migration after 0022. Does NOT rewrite 0000–0022.
--
-- Historical migrations (0000, 0021 comments) may still mention the retired column
-- for reproducibility. After this file applies, the live schema must not
-- contain hosted-IdP columns, indexes, or constraints.
--
-- Identity relationship after this migration:
--   auth_accounts.id  →  crm_staff.auth_account_id  (unique when present)
-- Handler membership columns (`handler_user_id`, etc.) remain opaque first-party
-- account ids and are not dropped here.

-- ---------------------------------------------------------------------------
-- 1. Deterministic reconciliation (email only, verified, unique)
-- ---------------------------------------------------------------------------
-- Link staff → first-party account when:
--   - staff.auth_account_id is NULL
--   - there is exactly one verified email identifier matching normalized email
--     (lower-case + trimmed; falls back from email_normalized to email)
--   - that account is not already linked to a different staff row
--   - no other unlinked staff row normalizes to the same email
-- Display-name matching is intentionally NOT used.
-- Ambiguous / duplicate matches are left unresolved (auth_account_id stays NULL).

WITH normalized_staff AS (
  SELECT
    s.id AS staff_id,
    lower(trim(COALESCE(NULLIF(trim(s.email_normalized), ''), s.email))) AS email_key
  FROM crm_staff s
  WHERE s.auth_account_id IS NULL
),
matched_accounts AS (
  SELECT DISTINCT
    ns.staff_id,
    ns.email_key,
    i.account_id AS account_id
  FROM normalized_staff ns
  INNER JOIN auth_identifiers i
    ON i.kind = 'email'
   AND i.verified = true
   AND lower(trim(i.value)) = ns.email_key
  WHERE ns.email_key <> ''
),
match_counts AS (
  SELECT staff_id, COUNT(*) AS match_count
  FROM matched_accounts
  GROUP BY staff_id
),
email_staff_counts AS (
  SELECT email_key, COUNT(*) AS staff_count
  FROM normalized_staff
  WHERE email_key <> ''
  GROUP BY email_key
),
unique_matches AS (
  SELECT ma.staff_id, ma.account_id
  FROM matched_accounts ma
  INNER JOIN match_counts mc
    ON mc.staff_id = ma.staff_id
  INNER JOIN email_staff_counts esc
    ON esc.email_key = ma.email_key
  WHERE mc.match_count = 1
    AND esc.staff_count = 1
    AND NOT EXISTS (
      SELECT 1
      FROM crm_staff other
      WHERE other.auth_account_id = ma.account_id
        AND other.id <> ma.staff_id
    )
)
UPDATE crm_staff s
SET auth_account_id = u.account_id
FROM unique_matches u
WHERE s.id = u.staff_id
  AND s.auth_account_id IS NULL;

-- Active staff that remain unlinked after reconciliation move to
-- pending_activation so authentication is blocked until invitation / owner
-- resolution. Already-suspended/terminated rows are left alone.
UPDATE crm_staff
SET status = 'pending_activation'
WHERE auth_account_id IS NULL
  AND status = 'active';

-- ---------------------------------------------------------------------------
-- 2. Drop retired identity column + unique index from live schema
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS crm_staff_clerk_uniq;
ALTER TABLE crm_staff DROP COLUMN IF EXISTS clerk_user_id;

-- ---------------------------------------------------------------------------
-- 3. Enforce one-account relationship when linked
-- ---------------------------------------------------------------------------
-- Partial unique index crm_staff_auth_account_uniq already exists from 0021
-- (WHERE auth_account_id IS NOT NULL). Keep it; do not replace with a
-- non-partial unique index.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_staff_auth_account_fk'
  ) THEN
    ALTER TABLE crm_staff
      ADD CONSTRAINT crm_staff_auth_account_fk
      FOREIGN KEY (auth_account_id)
      REFERENCES auth_accounts(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

ALTER TABLE crm_staff VALIDATE CONSTRAINT crm_staff_auth_account_fk;

COMMENT ON COLUMN crm_staff.auth_account_id IS
  'FK to auth_accounts.id (first-party auth). Sole staff identity relationship.';
