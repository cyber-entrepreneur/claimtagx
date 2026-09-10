-- Additive invite token support for first-party staff activation emails.
-- Stores ONLY a hash of the single-use invite token (never plaintext).

ALTER TABLE crm_staff_invites
  ADD COLUMN IF NOT EXISTS token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS crm_staff_invites_token_hash_uniq
  ON crm_staff_invites (token_hash)
  WHERE token_hash IS NOT NULL;
