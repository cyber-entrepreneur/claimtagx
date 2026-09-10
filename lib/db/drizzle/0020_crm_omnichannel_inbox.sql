-- Canonical omnichannel inbox: channel accounts, identities, conversation/message extensions.
-- Additive / upgrade-safe. String literals use SQL single quotes.

CREATE TABLE IF NOT EXISTS crm_channel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  provider_account_id text NOT NULL,
  display_name text NOT NULL,
  connection_status text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ref text,
  subscription_status text,
  subscription_expires_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_health_check_at timestamptz,
  last_error text,
  configuration_version integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  missing_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  live_verified_at timestamptz,
  verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_channel_accounts_status_chk CHECK (
    connection_status IN (
      'LIVE_VERIFIED',
      'IMPLEMENTED_AWAITING_CREDENTIALS',
      'BLOCKED_APP_REVIEW',
      'PARTNER_GATED',
      'UNSUPPORTED_BY_PUBLIC_API',
      'DISABLED',
      'ERROR'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_channel_accounts_channel_provider_uniq
  ON crm_channel_accounts (channel, provider_account_id);
CREATE INDEX IF NOT EXISTS crm_channel_accounts_status_idx
  ON crm_channel_accounts (connection_status, enabled);

ALTER TABLE crm_channel_accounts
  ADD COLUMN IF NOT EXISTS live_verified_at timestamptz;
ALTER TABLE crm_channel_accounts
  ADD COLUMN IF NOT EXISTS verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS crm_channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  provider_account_context text NOT NULL DEFAULT '',
  provider_user_id text NOT NULL,
  normalized_email text,
  normalized_phone text,
  handle text,
  display_name text,
  verification_status text NOT NULL DEFAULT 'provisional',
  confidence text NOT NULL DEFAULT 'low',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  merge_provenance jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_channel_identities_confidence_chk CHECK (confidence IN ('low', 'medium', 'high')),
  CONSTRAINT crm_channel_identities_verification_chk CHECK (
    verification_status IN ('provisional', 'verified', 'staff_linked')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_channel_identities_provider_user_uniq
  ON crm_channel_identities (channel, provider_account_context, provider_user_id);
CREATE INDEX IF NOT EXISTS crm_channel_identities_contact_idx
  ON crm_channel_identities (contact_id);
CREATE INDEX IF NOT EXISTS crm_channel_identities_email_idx
  ON crm_channel_identities (normalized_email);
CREATE INDEX IF NOT EXISTS crm_channel_identities_phone_idx
  ON crm_channel_identities (normalized_phone);

CREATE TABLE IF NOT EXISTS crm_pending_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id uuid NOT NULL REFERENCES crm_channel_accounts(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL,
  status text NOT NULL,
  failure_class text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_pending_deliveries_account_message_uniq
  ON crm_pending_deliveries (channel_account_id, provider_message_id);

ALTER TABLE crm_conversations
  ADD COLUMN IF NOT EXISTS channel_account_id uuid REFERENCES crm_channel_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_thread_id text,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS assigned_team_id uuid REFERENCES crm_teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES crm_staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS crm_conversations_provider_thread_uniq
  ON crm_conversations (channel_account_id, external_thread_id)
  WHERE channel_account_id IS NOT NULL AND external_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_conversations_channel_status_idx
  ON crm_conversations (channel, status, last_message_at);

ALTER TABLE crm_messages
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS channel_account_id uuid REFERENCES crm_channel_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_reply_to_id text,
  ADD COLUMN IF NOT EXISTS sender_json jsonb,
  ADD COLUMN IF NOT EXISTS recipients_json jsonb,
  ADD COLUMN IF NOT EXISTS attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS causation_id text,
  ADD COLUMN IF NOT EXISTS failure_class text,
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_provider_scoped_uniq
  ON crm_messages (channel_account_id, provider_message_id)
  WHERE channel_account_id IS NOT NULL AND provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_idempotency_uniq
  ON crm_messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_messages_delivery_idx
  ON crm_messages (delivery_status, created_at);

INSERT INTO crm_channel_accounts (
  channel, provider_account_id, display_name, connection_status, capabilities, credential_ref, enabled, missing_requirements
) VALUES
  (
    'website', 'contact-form', 'Website Contact', 'IMPLEMENTED_AWAITING_CREDENTIALS',
    '{"inbound":true,"outbound":true,"attachments":false,"templates":true,"readReceipts":false,"deliveryReceipts":false,"reconciliation":false,"replyWindowHours":null,"webhooks":false,"polling":false,"maxMessageBytes":8000,"allowedAttachmentTypes":[],"manualHandoff":false}'::jsonb,
    NULL, true, '[]'::jsonb
  ),
  (
    'microsoft365', 'exchange-mailbox', 'Microsoft 365 email', 'IMPLEMENTED_AWAITING_CREDENTIALS',
    '{"inbound":true,"outbound":true,"attachments":false,"templates":true,"readReceipts":false,"deliveryReceipts":false,"reconciliation":false,"replyWindowHours":null,"webhooks":true,"polling":true,"maxMessageBytes":10485760,"allowedAttachmentTypes":[],"manualHandoff":false}'::jsonb,
    'MS_GRAPH_*', true, '["Entra tenant","application permissions","admin consent","Exchange mailbox","Attachments temporarily unavailable pending controlled download"]'::jsonb
  ),
  (
    'whatsapp', 'cloud-api', 'WhatsApp Cloud API', 'IMPLEMENTED_AWAITING_CREDENTIALS',
    '{"inbound":true,"outbound":true,"attachments":false,"templates":true,"readReceipts":true,"deliveryReceipts":true,"reconciliation":false,"replyWindowHours":24,"webhooks":true,"polling":false,"maxMessageBytes":4096,"allowedAttachmentTypes":[],"manualHandoff":false}'::jsonb,
    'WHATSAPP_*', true, '["Meta business account","phone number","access token","webhook verify token","Attachments temporarily unavailable pending controlled download"]'::jsonb
  ),
  (
    'messenger', 'page-messaging', 'Facebook Messenger', 'IMPLEMENTED_AWAITING_CREDENTIALS',
    '{"inbound":true,"outbound":true,"attachments":false,"templates":false,"readReceipts":false,"deliveryReceipts":true,"reconciliation":false,"replyWindowHours":24,"webhooks":true,"polling":false,"maxMessageBytes":2000,"allowedAttachmentTypes":[],"manualHandoff":false}'::jsonb,
    'META_*', true, '["Meta app","Page token","pages_messaging","webhook","Attachments temporarily unavailable pending controlled download"]'::jsonb
  ),
  (
    'instagram', 'professional-messaging', 'Instagram Messaging', 'IMPLEMENTED_AWAITING_CREDENTIALS',
    '{"inbound":true,"outbound":true,"attachments":false,"templates":false,"readReceipts":false,"deliveryReceipts":true,"reconciliation":false,"replyWindowHours":24,"webhooks":true,"polling":false,"maxMessageBytes":1000,"allowedAttachmentTypes":[],"manualHandoff":false}'::jsonb,
    'META_*', true, '["Instagram professional account","connected Page","instagram_manage_messages","Attachments temporarily unavailable pending controlled download"]'::jsonb
  ),
  (
    'x', 'account-activity', 'X Direct Messages', 'IMPLEMENTED_AWAITING_CREDENTIALS',
    '{"inbound":true,"outbound":true,"attachments":false,"templates":false,"readReceipts":false,"deliveryReceipts":false,"reconciliation":false,"replyWindowHours":null,"webhooks":true,"polling":false,"maxMessageBytes":10000,"allowedAttachmentTypes":[],"manualHandoff":false}'::jsonb,
    'X_*', true, '["X developer account","OAuth","Account Activity webhook","X-Twitter-Webhooks-Signature","API tier"]'::jsonb
  ),
  (
    'tiktok', 'manual-handoff', 'TikTok (no public support DM API)', 'UNSUPPORTED_BY_PUBLIC_API',
    '{"inbound":false,"outbound":false,"attachments":false,"templates":false,"readReceipts":false,"deliveryReceipts":false,"reconciliation":false,"replyWindowHours":null,"webhooks":false,"polling":false,"maxMessageBytes":0,"allowedAttachmentTypes":[],"manualHandoff":true}'::jsonb,
    NULL, false, '["Official real-time customer-support DM API is not publicly available"]'::jsonb
  ),
  (
    'linkedin', 'partner-messaging', 'LinkedIn private messaging', 'PARTNER_GATED',
    '{"inbound":false,"outbound":false,"attachments":false,"templates":false,"readReceipts":false,"deliveryReceipts":false,"reconciliation":false,"replyWindowHours":null,"webhooks":false,"polling":false,"maxMessageBytes":0,"allowedAttachmentTypes":[],"manualHandoff":true}'::jsonb,
    'LINKEDIN_*', false, '["Approved LinkedIn partner private-messaging access"]'::jsonb
  )
ON CONFLICT (channel, provider_account_id) DO NOTHING;

UPDATE crm_channel_accounts
SET connection_status = 'IMPLEMENTED_AWAITING_CREDENTIALS',
    updated_at = now()
WHERE connection_status = 'LIVE_VERIFIED'
  AND live_verified_at IS NULL;
