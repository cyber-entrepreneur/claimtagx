-- Forward: 0001_crm_durable_jobs.sql, 0002_crm_email_threading.sql, 0003_crm_ops.sql
-- Rollback guidance (staging only; production requires explicit authorization):

-- 0003 rollback
-- DROP TABLE IF EXISTS crm_staff_invites;
-- DROP TABLE IF EXISTS crm_session_revocations;
-- DROP TABLE IF EXISTS crm_email_quarantine;
-- DROP TABLE IF EXISTS crm_legal_holds;
-- ALTER TABLE crm_saved_views DROP COLUMN IF EXISTS is_default;
-- ALTER TABLE crm_saved_views DROP COLUMN IF EXISTS scope;
-- ALTER TABLE crm_sla_instances DROP COLUMN IF EXISTS paused_at;
-- ALTER TABLE crm_sla_instances DROP COLUMN IF EXISTS remaining_ms;
-- DROP INDEX IF EXISTS crm_companies_name_uniq;

-- 0002 rollback (email threading columns)
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS message_id;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS references_header;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS provider_message_id;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS provider_event_id;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS delivery_status;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS bounce_type;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS complaint_type;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS sanitized_html;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS text_body;

-- 0001 rollback (durability)
-- DROP TABLE IF EXISTS crm_rate_limits;
-- ALTER TABLE crm_jobs DROP COLUMN IF EXISTS causation_id;
-- ALTER TABLE crm_jobs DROP COLUMN IF EXISTS locked_at;
-- ALTER TABLE crm_jobs DROP COLUMN IF EXISTS locked_by;
-- ALTER TABLE crm_jobs DROP COLUMN IF EXISTS lease_expires_at;
-- ALTER TABLE crm_inquiries DROP COLUMN IF EXISTS inquiry_type;

-- 0004 rollback
-- DROP TABLE IF EXISTS crm_config_changes;
-- ALTER TABLE crm_sla_policies DROP COLUMN IF EXISTS holidays;
-- ALTER TABLE crm_sla_policies DROP COLUMN IF EXISTS time_zone;

-- 0005 rollback
-- DROP TRIGGER IF EXISTS crm_audit_events_no_update ON crm_audit_events;
-- DROP TRIGGER IF EXISTS crm_audit_events_no_delete ON crm_audit_events;
-- DROP FUNCTION IF EXISTS crm_audit_events_immutable();
-- DROP TABLE IF EXISTS crm_contact_merges;
-- DROP TABLE IF EXISTS crm_webhook_receipts;
-- ALTER TABLE crm_jobs DROP COLUMN IF EXISTS claim_generation;
-- ALTER TABLE crm_jobs DROP COLUMN IF EXISTS idempotency_key;
-- 0006 rollback
-- DROP TRIGGER IF EXISTS crm_config_publications_no_update ON crm_config_publications;
-- DROP TRIGGER IF EXISTS crm_config_publications_no_delete ON crm_config_publications;
-- DROP FUNCTION IF EXISTS crm_config_publications_immutable();
-- DROP TABLE IF EXISTS crm_config_publications;
-- ALTER TABLE crm_config_changes DROP COLUMN IF EXISTS published_version;
-- ALTER TABLE crm_config_changes DROP COLUMN IF EXISTS rollback_of_id;
-- ALTER TABLE crm_config_changes DROP COLUMN IF EXISTS supersedes_id;
-- ALTER TABLE crm_config_changes DROP COLUMN IF EXISTS emergency;
-- ALTER TABLE crm_config_changes DROP COLUMN IF EXISTS emergency_reason;
-- ALTER TABLE crm_config_changes DROP COLUMN IF EXISTS schema_version;

-- 0007 rollback
-- DROP TRIGGER IF EXISTS crm_config_publications_lineage_guard ON crm_config_publications;
-- DROP FUNCTION IF EXISTS crm_config_publications_lineage_guard();
-- ALTER TABLE crm_job_effects DROP CONSTRAINT IF EXISTS crm_job_effects_job_fk;
-- ALTER TABLE crm_config_changes DROP CONSTRAINT IF EXISTS crm_config_changes_rollback_pub_fk;
-- ALTER TABLE crm_config_changes DROP CONSTRAINT IF EXISTS crm_config_changes_supersedes_change_fk;
-- ALTER TABLE crm_config_publications DROP CONSTRAINT IF EXISTS crm_config_publications_supersedes_fk;
-- ALTER TABLE crm_config_publications DROP CONSTRAINT IF EXISTS crm_config_publications_rollback_fk;
-- ALTER TABLE crm_config_changes DROP COLUMN IF EXISTS rollback_of_publication_id;
-- ALTER TABLE crm_config_changes DROP COLUMN IF EXISTS supersedes_change_id;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS claim_generation;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS processing_token;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS processing_owner;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS lease_expires_at;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS next_attempt_at;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS terminal;
-- DROP TABLE IF EXISTS crm_job_effects;

-- 0008 rollback
-- DROP TABLE IF EXISTS crm_attachments;
-- DROP TABLE IF EXISTS crm_opportunity_stages;
-- DROP TABLE IF EXISTS crm_opportunities;
-- DROP TABLE IF EXISTS crm_dsar_requests;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS raw_payload;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS payload_encrypted;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS normalized_payload;
-- ALTER TABLE crm_webhook_receipts DROP COLUMN IF EXISTS retained_until;

-- 0009 rollback
-- DROP TABLE IF EXISTS crm_outbound_sends;
-- ALTER TABLE crm_job_effects DROP COLUMN IF EXISTS claim_generation;
-- ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS probability;
-- ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS expected_close_at;
-- ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS lost_reason;
-- ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS team_id;
-- ALTER TABLE crm_schema_migrations DROP COLUMN IF EXISTS fingerprint;
-- 0010 rollback
-- DROP TABLE IF EXISTS crm_graph_mailbox_state;
-- Unknown partial schema: do not stamp crm_schema_migrations. Restore a verified dump or DROP the isolated database and re-run applyCrmMigrations. Never infer completeness from crm_inquiries alone.

-- 0011 rollback
-- Recreate prior recurring-job unique index shape only after verifying no Graph renewal/delta rows remain.

-- 0012 rollback
-- DROP TABLE IF EXISTS crm_marketing_audit;
-- DROP TABLE IF EXISTS crm_marketing_versions;
-- DROP TABLE IF EXISTS crm_marketing_documents;

-- 0013 rollback
-- DROP TABLE IF EXISTS crm_attachment_upload_parts;
-- DROP TABLE IF EXISTS crm_attachment_uploads;
-- ALTER TABLE crm_attachments DROP COLUMN IF EXISTS storage_provider;
-- ALTER TABLE crm_attachments DROP COLUMN IF EXISTS tombstoned_at;
-- ALTER TABLE crm_attachments DROP COLUMN IF EXISTS lock_version;
-- ALTER TABLE crm_attachments DROP COLUMN IF EXISTS scan_attempts;
-- ALTER TABLE crm_attachments DROP COLUMN IF EXISTS last_scan_at;
-- ALTER TABLE crm_attachments DROP COLUMN IF EXISTS retention_until;

-- 0015 rollback
-- DROP TABLE IF EXISTS crm_record_presence;
-- DROP TABLE IF EXISTS crm_record_locks;

-- 0016 rollback
-- DROP TABLE IF EXISTS crm_export_jobs;

-- 0017 rollback
-- ALTER TABLE crm_saved_views DROP COLUMN IF EXISTS team_id;
-- ALTER TABLE crm_saved_views DROP COLUMN IF EXISTS version;
-- ALTER TABLE crm_saved_views DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE crm_saved_views DROP COLUMN IF EXISTS updated_by;
-- DROP INDEX IF EXISTS crm_saved_views_scope_team_idx;
-- DROP INDEX IF EXISTS crm_saved_views_staff_default_idx;
-- DROP INDEX IF EXISTS crm_inquiries_reference_idx;
-- DROP INDEX IF EXISTS crm_inquiries_status_priority_idx;
-- DROP INDEX IF EXISTS crm_inquiries_owner_updated_idx;
-- DROP INDEX IF EXISTS crm_inquiries_type_created_idx;

-- 0018 rollback
-- DROP TRIGGER IF EXISTS crm_marketing_audit_no_update ON crm_marketing_audit;
-- DROP TRIGGER IF EXISTS crm_marketing_audit_no_delete ON crm_marketing_audit;
-- DROP FUNCTION IF EXISTS crm_marketing_audit_immutable();

-- 0020 rollback (documentation only — do not execute against databases with user data)
-- DROP TABLE IF EXISTS crm_pending_deliveries;
-- DROP TABLE IF EXISTS crm_channel_identities;
-- DROP INDEX IF EXISTS crm_conversations_provider_thread_uniq;
-- DROP INDEX IF EXISTS crm_messages_provider_scoped_uniq;
-- DROP INDEX IF EXISTS crm_messages_idempotency_uniq;
-- ALTER TABLE crm_conversations DROP COLUMN IF EXISTS channel_account_id;
-- ALTER TABLE crm_conversations DROP COLUMN IF EXISTS external_thread_id;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS direction;
-- ALTER TABLE crm_messages DROP COLUMN IF EXISTS channel_account_id;
-- DROP TABLE IF EXISTS crm_channel_accounts;

-- 0019 rollback
-- ALTER TABLE crm_staff DROP COLUMN IF EXISTS region;
-- ALTER TABLE crm_staff DROP COLUMN IF EXISTS languages;
-- ALTER TABLE crm_staff DROP COLUMN IF EXISTS specialties;
-- ALTER TABLE crm_staff DROP COLUMN IF EXISTS capacity_limit;
-- ALTER TABLE crm_staff DROP COLUMN IF EXISTS ooo_until;
-- ALTER TABLE crm_staff DROP COLUMN IF EXISTS ooo_reason;
