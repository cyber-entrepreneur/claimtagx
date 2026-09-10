-- ClaimTagX Contact CRM: Microsoft Graph mailbox subscription and delta sync state

CREATE TABLE IF NOT EXISTS "crm_graph_mailbox_state" (
  "mailbox_upn" text PRIMARY KEY,
  "subscription_id" text,
  "subscription_expires_at" timestamptz,
  "client_state_hash" text NOT NULL,
  "delta_link_encrypted" text,
  "delta_link_fingerprint" text,
  "last_sync_at" timestamptz,
  "last_notification_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "crm_graph_mailbox_subscription_exp_idx"
  ON "crm_graph_mailbox_state" ("subscription_expires_at");
