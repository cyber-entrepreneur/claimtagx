-- ClaimTagX CRM baseline (empty-database bootstrap).
-- Captures CRM objects as of incremental migration 0007.
-- New installs: apply this file first, then incremental 0001+ (IF NOT EXISTS / additive).
-- Existing installs that already applied 0001–0007 must not re-bootstrap; the migrator stamps 0000.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);

CREATE OR REPLACE FUNCTION public.crm_audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm_audit_events is insert-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_config_publications_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm_config_publications is insert-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_config_publications_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM crm_config_publications p
      WHERE p.id = NEW.supersedes_id AND p.entity_type = NEW.entity_type AND p.entity_id = NEW.entity_id
    ) THEN
      RAISE EXCEPTION 'cross-stream supersedes_id is not allowed';
    END IF;
  END IF;
  IF NEW.rollback_of_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM crm_config_publications p
      WHERE p.id = NEW.rollback_of_id AND p.entity_type = NEW.entity_type AND p.entity_id = NEW.entity_id
    ) THEN
      RAISE EXCEPTION 'cross-stream rollback_of_id is not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

SET default_tablespace = '';
SET default_table_access_method = heap;


--
-- Name: crm_ai_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_ai_classifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inquiry_id uuid NOT NULL,
    provider text NOT NULL,
    model text,
    confidence integer,
    output jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event text NOT NULL,
    inquiry_id uuid,
    contact_id uuid,
    properties jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    inquiry_id uuid,
    contact_id uuid,
    before_value jsonb,
    after_value jsonb,
    workflow_id uuid,
    correlation_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    name_normalized text NOT NULL,
    country text,
    website text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_config_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_config_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    summary text,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    before_value jsonb,
    after_value jsonb NOT NULL,
    author_staff_id uuid,
    reviewer_staff_id uuid,
    publisher_staff_id uuid,
    effective_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lock_version integer DEFAULT 0 NOT NULL,
    published_version integer,
    rollback_of_id uuid,
    supersedes_id uuid,
    emergency boolean DEFAULT false NOT NULL,
    emergency_reason text,
    schema_version integer DEFAULT 1 NOT NULL,
    rollback_of_publication_id uuid,
    supersedes_change_id uuid
);


--
-- Name: crm_config_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_config_publications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    published_version integer NOT NULL,
    change_id uuid NOT NULL,
    supersedes_id uuid,
    rollback_of_id uuid,
    before_value jsonb,
    after_value jsonb NOT NULL,
    author_staff_id text,
    reviewer_staff_id text,
    publisher_staff_id text,
    emergency boolean DEFAULT false NOT NULL,
    emergency_reason text,
    schema_version integer DEFAULT 1 NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone
);


--
-- Name: crm_consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_consent_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    inquiry_id uuid,
    kind text NOT NULL,
    granted boolean NOT NULL,
    terms_version text,
    privacy_policy_version text,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_contact_merges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_contact_merges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    winner_id uuid NOT NULL,
    loser_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    plan jsonb NOT NULL,
    actor_staff_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    first_name text NOT NULL,
    last_name text NOT NULL,
    job_title text NOT NULL,
    email text NOT NULL,
    email_normalized text NOT NULL,
    country text NOT NULL,
    phone_raw text,
    phone_country text,
    phone_country_calling_code text,
    phone_national_number text,
    phone_e164 text,
    phone_validation_status text,
    phone_type text,
    locale text,
    lifecycle_stage text DEFAULT 'contact'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inquiry_id uuid NOT NULL,
    channel text DEFAULT 'web_form'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_email_quarantine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_email_quarantine (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reason text NOT NULL,
    subject text,
    message_id text,
    in_reply_to text,
    payload jsonb,
    status text DEFAULT 'open'::text NOT NULL,
    reconciled_inquiry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text NOT NULL,
    contact_id uuid NOT NULL,
    company_id uuid,
    status text DEFAULT 'NEW'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    source text DEFAULT 'website'::text NOT NULL,
    channel text DEFAULT 'web_form'::text NOT NULL,
    inquiry_type text DEFAULT 'sales'::text NOT NULL,
    use_case_keys jsonb DEFAULT '[]'::jsonb NOT NULL,
    use_case_other text,
    assigned_team_id uuid,
    assigned_staff_id uuid,
    assigned_reason text,
    qualification_status text DEFAULT 'UNASSESSED'::text NOT NULL,
    qualification_score integer DEFAULT 0 NOT NULL,
    qualification_grade text,
    qualification_model_id uuid,
    qualification_model_version integer,
    system_qualification_status text,
    human_override_status text,
    human_override_reason text,
    human_override_by uuid,
    human_override_at timestamp with time zone,
    qualified_at timestamp with time zone,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    last_customer_message_at timestamp with time zone,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    meeting_offered_at timestamp with time zone,
    spam_score integer DEFAULT 0 NOT NULL,
    idempotency_key text,
    attribution jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_inquiry_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_inquiry_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inquiry_id uuid NOT NULL,
    question_key text NOT NULL,
    option_keys jsonb DEFAULT '[]'::jsonb NOT NULL,
    free_text text
);


--
-- Name: crm_inquiry_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_inquiry_counters (
    year integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);


--
-- Name: crm_inquiry_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_inquiry_reads (
    inquiry_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_inquiry_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_inquiry_tags (
    inquiry_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: crm_job_effects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_job_effects (
    idempotency_key text NOT NULL,
    job_id uuid,
    kind text NOT NULL,
    status text DEFAULT 'committed'::text NOT NULL,
    provider_message_id text,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 8 NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    correlation_id text,
    causation_id text,
    locked_at timestamp with time zone,
    locked_by text,
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    claim_generation integer DEFAULT 0 NOT NULL,
    idempotency_key text
);


--
-- Name: crm_legal_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_legal_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid,
    inquiry_id uuid,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone
);


--
-- Name: crm_macros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_macros (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    actions jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_meeting_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_meeting_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    booking_url text NOT NULL,
    team_id uuid,
    calendar_source text DEFAULT 'external'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL
);


--
-- Name: crm_meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inquiry_id uuid,
    contact_id uuid,
    meeting_type_id uuid,
    assigned_staff_id uuid,
    assigned_team_id uuid,
    booking_url text NOT NULL,
    booking_status text DEFAULT 'INVITED'::text NOT NULL,
    scheduled_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    rescheduled_at timestamp with time zone,
    external_booking_id text,
    timezone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    inquiry_id uuid NOT NULL,
    kind text NOT NULL,
    visibility text DEFAULT 'customer'::text NOT NULL,
    channel text DEFAULT 'web_form'::text NOT NULL,
    author_type text NOT NULL,
    author_staff_id uuid,
    author_contact_id uuid,
    subject text,
    body text NOT NULL,
    body_html text,
    text_body text,
    sanitized_html text,
    template_id uuid,
    template_version_id uuid,
    message_id text,
    external_message_id text,
    in_reply_to text,
    references_header text,
    provider_message_id text,
    provider_event_id text,
    delivery_status text,
    bounce_type text,
    complaint_type text,
    forwarded_to text,
    mentions jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    inquiry_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_qualification_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_qualification_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    thresholds jsonb NOT NULL,
    rules jsonb NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_qualification_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_qualification_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inquiry_id uuid NOT NULL,
    model_id uuid,
    model_version integer NOT NULL,
    score integer NOT NULL,
    grade text,
    status text NOT NULL,
    reasons jsonb NOT NULL,
    source text DEFAULT 'system'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_rate_limits (
    bucket_key text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_routing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_routing_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    strategy text DEFAULT 'team'::text NOT NULL,
    team_id uuid,
    staff_id uuid,
    reason_template text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_saved_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    name text NOT NULL,
    filters jsonb NOT NULL,
    columns jsonb,
    sort jsonb,
    is_default boolean DEFAULT false NOT NULL,
    scope text DEFAULT 'personal'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_session_revocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_session_revocations (
    staff_id uuid NOT NULL,
    revoked_before timestamp with time zone NOT NULL
);


--
-- Name: crm_sla_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sla_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inquiry_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    policy_version integer NOT NULL,
    measure text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    status text DEFAULT 'ON_TRACK'::text NOT NULL,
    completed_at timestamp with time zone,
    paused_at timestamp with time zone,
    remaining_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_sla_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sla_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    first_response_minutes integer NOT NULL,
    next_response_minutes integer,
    resolution_minutes integer,
    conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    holidays jsonb DEFAULT '[]'::jsonb NOT NULL,
    time_zone text DEFAULT 'UTC'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clerk_user_id text,
    email text NOT NULL,
    email_normalized text NOT NULL,
    name text NOT NULL,
    role text DEFAULT 'sales'::text NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    team_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_staff_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_staff_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email_normalized text NOT NULL,
    role text DEFAULT 'sales'::text NOT NULL,
    invited_by uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    color text
);


--
-- Name: crm_taxonomy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_taxonomy (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    key text NOT NULL,
    parent_key text DEFAULT ''::text NOT NULL,
    label text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb
);


--
-- Name: crm_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_team_members (
    team_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: crm_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    region text,
    round_robin_cursor integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_template_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_template_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    version_number integer NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    change_summary text,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    internal_name text NOT NULL,
    description text,
    category text DEFAULT 'acknowledgment'::text NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    published_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_webhook_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_webhook_receipts (
    provider_event_id text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    payload_hash text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    processed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_generation integer DEFAULT 0 NOT NULL,
    processing_token text,
    processing_owner text,
    lease_expires_at timestamp with time zone,
    next_attempt_at timestamp with time zone,
    terminal boolean DEFAULT false NOT NULL
);


--
-- Name: crm_workflow_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_workflow_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id uuid NOT NULL,
    workflow_version integer NOT NULL,
    inquiry_id uuid,
    trigger text NOT NULL,
    matched jsonb,
    status text NOT NULL,
    error text,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    trigger text NOT NULL,
    conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_ai_classifications crm_ai_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_ai_classifications
    ADD CONSTRAINT crm_ai_classifications_pkey PRIMARY KEY (id);


--
-- Name: crm_analytics_events crm_analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_analytics_events
    ADD CONSTRAINT crm_analytics_events_pkey PRIMARY KEY (id);


--
-- Name: crm_audit_events crm_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_audit_events
    ADD CONSTRAINT crm_audit_events_pkey PRIMARY KEY (id);


--
-- Name: crm_companies crm_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_companies
    ADD CONSTRAINT crm_companies_pkey PRIMARY KEY (id);


--
-- Name: crm_config_changes crm_config_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_changes
    ADD CONSTRAINT crm_config_changes_pkey PRIMARY KEY (id);


--
-- Name: crm_config crm_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config
    ADD CONSTRAINT crm_config_pkey PRIMARY KEY (key);


--
-- Name: crm_config_publications crm_config_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_publications
    ADD CONSTRAINT crm_config_publications_pkey PRIMARY KEY (id);


--
-- Name: crm_consent_records crm_consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_records
    ADD CONSTRAINT crm_consent_records_pkey PRIMARY KEY (id);


--
-- Name: crm_contact_merges crm_contact_merges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contact_merges
    ADD CONSTRAINT crm_contact_merges_pkey PRIMARY KEY (id);


--
-- Name: crm_contacts crm_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_pkey PRIMARY KEY (id);


--
-- Name: crm_conversations crm_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversations
    ADD CONSTRAINT crm_conversations_pkey PRIMARY KEY (id);


--
-- Name: crm_email_quarantine crm_email_quarantine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_email_quarantine
    ADD CONSTRAINT crm_email_quarantine_pkey PRIMARY KEY (id);


--
-- Name: crm_inquiries crm_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiries
    ADD CONSTRAINT crm_inquiries_pkey PRIMARY KEY (id);


--
-- Name: crm_inquiry_answers crm_inquiry_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_answers
    ADD CONSTRAINT crm_inquiry_answers_pkey PRIMARY KEY (id);


--
-- Name: crm_inquiry_counters crm_inquiry_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_counters
    ADD CONSTRAINT crm_inquiry_counters_pkey PRIMARY KEY (year);


--
-- Name: crm_inquiry_reads crm_inquiry_reads_inquiry_id_staff_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_reads
    ADD CONSTRAINT crm_inquiry_reads_inquiry_id_staff_id_pk PRIMARY KEY (inquiry_id, staff_id);


--
-- Name: crm_inquiry_tags crm_inquiry_tags_inquiry_id_tag_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_tags
    ADD CONSTRAINT crm_inquiry_tags_inquiry_id_tag_id_pk PRIMARY KEY (inquiry_id, tag_id);


--
-- Name: crm_job_effects crm_job_effects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_job_effects
    ADD CONSTRAINT crm_job_effects_pkey PRIMARY KEY (idempotency_key);


--
-- Name: crm_jobs crm_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_jobs
    ADD CONSTRAINT crm_jobs_pkey PRIMARY KEY (id);


--
-- Name: crm_legal_holds crm_legal_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_legal_holds
    ADD CONSTRAINT crm_legal_holds_pkey PRIMARY KEY (id);


--
-- Name: crm_macros crm_macros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_macros
    ADD CONSTRAINT crm_macros_pkey PRIMARY KEY (id);


--
-- Name: crm_meeting_types crm_meeting_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_meeting_types
    ADD CONSTRAINT crm_meeting_types_pkey PRIMARY KEY (id);


--
-- Name: crm_meetings crm_meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_meetings
    ADD CONSTRAINT crm_meetings_pkey PRIMARY KEY (id);


--
-- Name: crm_messages crm_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_pkey PRIMARY KEY (id);


--
-- Name: crm_notifications crm_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notifications
    ADD CONSTRAINT crm_notifications_pkey PRIMARY KEY (id);


--
-- Name: crm_qualification_models crm_qualification_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_models
    ADD CONSTRAINT crm_qualification_models_pkey PRIMARY KEY (id);


--
-- Name: crm_qualification_results crm_qualification_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_results
    ADD CONSTRAINT crm_qualification_results_pkey PRIMARY KEY (id);


--
-- Name: crm_rate_limits crm_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_rate_limits
    ADD CONSTRAINT crm_rate_limits_pkey PRIMARY KEY (bucket_key);


--
-- Name: crm_routing_rules crm_routing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_routing_rules
    ADD CONSTRAINT crm_routing_rules_pkey PRIMARY KEY (id);


--
-- Name: crm_saved_views crm_saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_saved_views
    ADD CONSTRAINT crm_saved_views_pkey PRIMARY KEY (id);


--
-- Name: crm_session_revocations crm_session_revocations_staff_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_session_revocations
    ADD CONSTRAINT crm_session_revocations_staff_id_pk PRIMARY KEY (staff_id);


--
-- Name: crm_sla_instances crm_sla_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_pkey PRIMARY KEY (id);


--
-- Name: crm_sla_policies crm_sla_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_policies
    ADD CONSTRAINT crm_sla_policies_pkey PRIMARY KEY (id);


--
-- Name: crm_staff_invites crm_staff_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_staff_invites
    ADD CONSTRAINT crm_staff_invites_pkey PRIMARY KEY (id);


--
-- Name: crm_staff crm_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_staff
    ADD CONSTRAINT crm_staff_pkey PRIMARY KEY (id);


--
-- Name: crm_tags crm_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tags
    ADD CONSTRAINT crm_tags_pkey PRIMARY KEY (id);


--
-- Name: crm_taxonomy crm_taxonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_taxonomy
    ADD CONSTRAINT crm_taxonomy_pkey PRIMARY KEY (id);


--
-- Name: crm_team_members crm_team_members_team_id_staff_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_team_members
    ADD CONSTRAINT crm_team_members_team_id_staff_id_pk PRIMARY KEY (team_id, staff_id);


--
-- Name: crm_teams crm_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_teams
    ADD CONSTRAINT crm_teams_pkey PRIMARY KEY (id);


--
-- Name: crm_template_versions crm_template_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_template_versions
    ADD CONSTRAINT crm_template_versions_pkey PRIMARY KEY (id);


--
-- Name: crm_templates crm_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_templates
    ADD CONSTRAINT crm_templates_pkey PRIMARY KEY (id);


--
-- Name: crm_webhook_receipts crm_webhook_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_webhook_receipts
    ADD CONSTRAINT crm_webhook_receipts_pkey PRIMARY KEY (provider_event_id);


--
-- Name: crm_workflow_executions crm_workflow_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflow_executions
    ADD CONSTRAINT crm_workflow_executions_pkey PRIMARY KEY (id);


--
-- Name: crm_workflows crm_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflows
    ADD CONSTRAINT crm_workflows_pkey PRIMARY KEY (id);


--
-- Name: crm_analytics_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_analytics_event_idx ON public.crm_analytics_events USING btree (event, created_at);


--
-- Name: crm_analytics_inquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_analytics_inquiry_idx ON public.crm_analytics_events USING btree (inquiry_id);


--
-- Name: crm_answers_inquiry_question_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_answers_inquiry_question_uniq ON public.crm_inquiry_answers USING btree (inquiry_id, question_key);


--
-- Name: crm_answers_question_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_answers_question_idx ON public.crm_inquiry_answers USING btree (question_key);


--
-- Name: crm_audit_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_action_idx ON public.crm_audit_events USING btree (action, created_at);


--
-- Name: crm_audit_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_entity_idx ON public.crm_audit_events USING btree (entity_type, entity_id, created_at);


--
-- Name: crm_audit_inquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_inquiry_idx ON public.crm_audit_events USING btree (inquiry_id, created_at);


--
-- Name: crm_companies_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_companies_name_idx ON public.crm_companies USING btree (name_normalized);


--
-- Name: crm_companies_name_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_companies_name_uniq ON public.crm_companies USING btree (name_normalized);


--
-- Name: crm_config_changes_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_config_changes_entity_idx ON public.crm_config_changes USING btree (entity_type, entity_id, created_at);


--
-- Name: crm_config_changes_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_config_changes_status_idx ON public.crm_config_changes USING btree (status, created_at);


--
-- Name: crm_config_publications_stream_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_config_publications_stream_idx ON public.crm_config_publications USING btree (entity_type, entity_id, published_at);


--
-- Name: crm_config_publications_stream_version_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_config_publications_stream_version_uidx ON public.crm_config_publications USING btree (entity_type, entity_id, published_version);


--
-- Name: crm_consent_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_consent_contact_idx ON public.crm_consent_records USING btree (contact_id, created_at);


--
-- Name: crm_contact_merges_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_contact_merges_idempotency_uidx ON public.crm_contact_merges USING btree (idempotency_key);


--
-- Name: crm_contacts_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_company_idx ON public.crm_contacts USING btree (company_id);


--
-- Name: crm_contacts_email_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_contacts_email_uniq ON public.crm_contacts USING btree (email_normalized);


--
-- Name: crm_contacts_phone_e164_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contacts_phone_e164_idx ON public.crm_contacts USING btree (phone_e164);


--
-- Name: crm_conversations_inquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_conversations_inquiry_idx ON public.crm_conversations USING btree (inquiry_id);


--
-- Name: crm_email_quarantine_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_email_quarantine_status_idx ON public.crm_email_quarantine USING btree (status, created_at);


--
-- Name: crm_inquiries_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_inquiries_activity_idx ON public.crm_inquiries USING btree (last_activity_at);


--
-- Name: crm_inquiries_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_inquiries_assigned_idx ON public.crm_inquiries USING btree (assigned_staff_id, status);


--
-- Name: crm_inquiries_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_inquiries_contact_idx ON public.crm_inquiries USING btree (contact_id, created_at);


--
-- Name: crm_inquiries_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_inquiries_created_idx ON public.crm_inquiries USING btree (created_at);


--
-- Name: crm_inquiries_idempotency_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_inquiries_idempotency_uniq ON public.crm_inquiries USING btree (idempotency_key);


--
-- Name: crm_inquiries_qual_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_inquiries_qual_idx ON public.crm_inquiries USING btree (qualification_status, created_at);


--
-- Name: crm_inquiries_reference_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_inquiries_reference_uniq ON public.crm_inquiries USING btree (reference);


--
-- Name: crm_inquiries_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_inquiries_status_idx ON public.crm_inquiries USING btree (status, created_at);


--
-- Name: crm_job_effects_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_job_effects_kind_idx ON public.crm_job_effects USING btree (kind, created_at);


--
-- Name: crm_jobs_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_jobs_idempotency_uidx ON public.crm_jobs USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: crm_jobs_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_jobs_lease_idx ON public.crm_jobs USING btree (status, lease_expires_at);


--
-- Name: crm_jobs_recurring_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_jobs_recurring_active_uidx ON public.crm_jobs USING btree (type) WHERE ((type = ANY (ARRAY['refresh_sla'::text, 'enforce_retention'::text])) AND (status = ANY (ARRAY['pending'::text, 'running'::text])));


--
-- Name: crm_jobs_status_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_jobs_status_run_idx ON public.crm_jobs USING btree (status, run_at);


--
-- Name: crm_legal_holds_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_legal_holds_contact_idx ON public.crm_legal_holds USING btree (contact_id, released_at);


--
-- Name: crm_legal_holds_inquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_legal_holds_inquiry_idx ON public.crm_legal_holds USING btree (inquiry_id, released_at);


--
-- Name: crm_macros_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_macros_key_uniq ON public.crm_macros USING btree (key);


--
-- Name: crm_meeting_types_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_meeting_types_key_uniq ON public.crm_meeting_types USING btree (key);


--
-- Name: crm_meetings_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_meetings_contact_idx ON public.crm_meetings USING btree (contact_id);


--
-- Name: crm_meetings_inquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_meetings_inquiry_idx ON public.crm_meetings USING btree (inquiry_id);


--
-- Name: crm_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_conversation_idx ON public.crm_messages USING btree (conversation_id, created_at);


--
-- Name: crm_messages_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_external_idx ON public.crm_messages USING btree (external_message_id);


--
-- Name: crm_messages_inquiry_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_inquiry_created_idx ON public.crm_messages USING btree (inquiry_id, created_at);


--
-- Name: crm_messages_message_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_messages_message_id_uniq ON public.crm_messages USING btree (message_id);


--
-- Name: crm_messages_provider_event_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_messages_provider_event_id_uniq ON public.crm_messages USING btree (provider_event_id);


--
-- Name: crm_messages_provider_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_provider_message_idx ON public.crm_messages USING btree (provider_message_id);


--
-- Name: crm_notifications_staff_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_notifications_staff_idx ON public.crm_notifications USING btree (staff_id, created_at);


--
-- Name: crm_qual_results_inquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_qual_results_inquiry_idx ON public.crm_qualification_results USING btree (inquiry_id, created_at);


--
-- Name: crm_rate_limits_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_rate_limits_window_idx ON public.crm_rate_limits USING btree (window_started_at);


--
-- Name: crm_sla_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sla_due_idx ON public.crm_sla_instances USING btree (due_at, status);


--
-- Name: crm_sla_inquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sla_inquiry_idx ON public.crm_sla_instances USING btree (inquiry_id, status);


--
-- Name: crm_staff_clerk_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_staff_clerk_uniq ON public.crm_staff USING btree (clerk_user_id);


--
-- Name: crm_staff_email_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_staff_email_uniq ON public.crm_staff USING btree (email_normalized);


--
-- Name: crm_staff_invites_email_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_staff_invites_email_uniq ON public.crm_staff_invites USING btree (email_normalized);


--
-- Name: crm_tags_slug_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_tags_slug_uniq ON public.crm_tags USING btree (slug);


--
-- Name: crm_taxonomy_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_taxonomy_kind_idx ON public.crm_taxonomy USING btree (kind, sort_order);


--
-- Name: crm_taxonomy_scope_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_taxonomy_scope_uniq ON public.crm_taxonomy USING btree (kind, parent_key, key);


--
-- Name: crm_teams_slug_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_teams_slug_uniq ON public.crm_teams USING btree (slug);


--
-- Name: crm_template_ver_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_template_ver_uniq ON public.crm_template_versions USING btree (template_id, language, version_number);


--
-- Name: crm_templates_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_templates_key_uniq ON public.crm_templates USING btree (key);


--
-- Name: crm_workflow_exec_idem_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_workflow_exec_idem_uniq ON public.crm_workflow_executions USING btree (idempotency_key);


--
-- Name: crm_workflow_exec_inquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_workflow_exec_inquiry_idx ON public.crm_workflow_executions USING btree (inquiry_id, created_at);


--
-- Name: crm_workflows_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_workflows_key_uniq ON public.crm_workflows USING btree (key);


--
-- Name: crm_audit_events crm_audit_events_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_audit_events_no_delete BEFORE DELETE ON public.crm_audit_events FOR EACH ROW EXECUTE FUNCTION public.crm_audit_events_immutable();


--
-- Name: crm_audit_events crm_audit_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_audit_events_no_update BEFORE UPDATE ON public.crm_audit_events FOR EACH ROW EXECUTE FUNCTION public.crm_audit_events_immutable();


--
-- Name: crm_config_publications crm_config_publications_lineage_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_config_publications_lineage_guard BEFORE INSERT ON public.crm_config_publications FOR EACH ROW EXECUTE FUNCTION public.crm_config_publications_lineage_guard();


--
-- Name: crm_config_publications crm_config_publications_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_config_publications_no_delete BEFORE DELETE ON public.crm_config_publications FOR EACH ROW EXECUTE FUNCTION public.crm_config_publications_immutable();


--
-- Name: crm_config_publications crm_config_publications_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_config_publications_no_update BEFORE UPDATE ON public.crm_config_publications FOR EACH ROW EXECUTE FUNCTION public.crm_config_publications_immutable();


--
-- Name: crm_ai_classifications crm_ai_classifications_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_ai_classifications
    ADD CONSTRAINT crm_ai_classifications_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_config_changes crm_config_changes_author_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_changes
    ADD CONSTRAINT crm_config_changes_author_staff_id_crm_staff_id_fk FOREIGN KEY (author_staff_id) REFERENCES public.crm_staff(id);


--
-- Name: crm_config_changes crm_config_changes_publisher_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_changes
    ADD CONSTRAINT crm_config_changes_publisher_staff_id_crm_staff_id_fk FOREIGN KEY (publisher_staff_id) REFERENCES public.crm_staff(id);


--
-- Name: crm_config_changes crm_config_changes_reviewer_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_changes
    ADD CONSTRAINT crm_config_changes_reviewer_staff_id_crm_staff_id_fk FOREIGN KEY (reviewer_staff_id) REFERENCES public.crm_staff(id);


--
-- Name: crm_config_changes crm_config_changes_rollback_pub_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_changes
    ADD CONSTRAINT crm_config_changes_rollback_pub_fk FOREIGN KEY (rollback_of_publication_id) REFERENCES public.crm_config_publications(id) ON DELETE RESTRICT;


--
-- Name: crm_config_changes crm_config_changes_supersedes_change_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_changes
    ADD CONSTRAINT crm_config_changes_supersedes_change_fk FOREIGN KEY (supersedes_change_id) REFERENCES public.crm_config_changes(id) ON DELETE RESTRICT;


--
-- Name: crm_config_publications crm_config_publications_change_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_publications
    ADD CONSTRAINT crm_config_publications_change_id_fkey FOREIGN KEY (change_id) REFERENCES public.crm_config_changes(id) ON DELETE RESTRICT;


--
-- Name: crm_config_publications crm_config_publications_rollback_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_publications
    ADD CONSTRAINT crm_config_publications_rollback_fk FOREIGN KEY (rollback_of_id) REFERENCES public.crm_config_publications(id) ON DELETE RESTRICT;


--
-- Name: crm_config_publications crm_config_publications_supersedes_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_config_publications
    ADD CONSTRAINT crm_config_publications_supersedes_fk FOREIGN KEY (supersedes_id) REFERENCES public.crm_config_publications(id) ON DELETE RESTRICT;


--
-- Name: crm_consent_records crm_consent_records_contact_id_crm_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_records
    ADD CONSTRAINT crm_consent_records_contact_id_crm_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE CASCADE;


--
-- Name: crm_consent_records crm_consent_records_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_records
    ADD CONSTRAINT crm_consent_records_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE SET NULL;


--
-- Name: crm_contact_merges crm_contact_merges_winner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contact_merges
    ADD CONSTRAINT crm_contact_merges_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.crm_contacts(id) ON DELETE RESTRICT;


--
-- Name: crm_contacts crm_contacts_company_id_crm_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_company_id_crm_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON DELETE SET NULL;


--
-- Name: crm_conversations crm_conversations_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversations
    ADD CONSTRAINT crm_conversations_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_inquiries crm_inquiries_assigned_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiries
    ADD CONSTRAINT crm_inquiries_assigned_staff_id_crm_staff_id_fk FOREIGN KEY (assigned_staff_id) REFERENCES public.crm_staff(id) ON DELETE SET NULL;


--
-- Name: crm_inquiries crm_inquiries_assigned_team_id_crm_teams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiries
    ADD CONSTRAINT crm_inquiries_assigned_team_id_crm_teams_id_fk FOREIGN KEY (assigned_team_id) REFERENCES public.crm_teams(id) ON DELETE SET NULL;


--
-- Name: crm_inquiries crm_inquiries_company_id_crm_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiries
    ADD CONSTRAINT crm_inquiries_company_id_crm_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON DELETE SET NULL;


--
-- Name: crm_inquiries crm_inquiries_contact_id_crm_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiries
    ADD CONSTRAINT crm_inquiries_contact_id_crm_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE RESTRICT;


--
-- Name: crm_inquiry_answers crm_inquiry_answers_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_answers
    ADD CONSTRAINT crm_inquiry_answers_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_inquiry_reads crm_inquiry_reads_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_reads
    ADD CONSTRAINT crm_inquiry_reads_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_inquiry_reads crm_inquiry_reads_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_reads
    ADD CONSTRAINT crm_inquiry_reads_staff_id_crm_staff_id_fk FOREIGN KEY (staff_id) REFERENCES public.crm_staff(id) ON DELETE CASCADE;


--
-- Name: crm_inquiry_tags crm_inquiry_tags_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_tags
    ADD CONSTRAINT crm_inquiry_tags_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_inquiry_tags crm_inquiry_tags_tag_id_crm_tags_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inquiry_tags
    ADD CONSTRAINT crm_inquiry_tags_tag_id_crm_tags_id_fk FOREIGN KEY (tag_id) REFERENCES public.crm_tags(id) ON DELETE CASCADE;


--
-- Name: crm_job_effects crm_job_effects_job_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_job_effects
    ADD CONSTRAINT crm_job_effects_job_fk FOREIGN KEY (job_id) REFERENCES public.crm_jobs(id) ON DELETE SET NULL;


--
-- Name: crm_legal_holds crm_legal_holds_contact_id_crm_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_legal_holds
    ADD CONSTRAINT crm_legal_holds_contact_id_crm_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE CASCADE;


--
-- Name: crm_legal_holds crm_legal_holds_created_by_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_legal_holds
    ADD CONSTRAINT crm_legal_holds_created_by_crm_staff_id_fk FOREIGN KEY (created_by) REFERENCES public.crm_staff(id);


--
-- Name: crm_legal_holds crm_legal_holds_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_legal_holds
    ADD CONSTRAINT crm_legal_holds_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_meetings crm_meetings_contact_id_crm_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_meetings
    ADD CONSTRAINT crm_meetings_contact_id_crm_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id) ON DELETE SET NULL;


--
-- Name: crm_meetings crm_meetings_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_meetings
    ADD CONSTRAINT crm_meetings_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE SET NULL;


--
-- Name: crm_meetings crm_meetings_meeting_type_id_crm_meeting_types_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_meetings
    ADD CONSTRAINT crm_meetings_meeting_type_id_crm_meeting_types_id_fk FOREIGN KEY (meeting_type_id) REFERENCES public.crm_meeting_types(id);


--
-- Name: crm_messages crm_messages_conversation_id_crm_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_conversation_id_crm_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.crm_conversations(id) ON DELETE CASCADE;


--
-- Name: crm_messages crm_messages_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_notifications crm_notifications_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notifications
    ADD CONSTRAINT crm_notifications_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_notifications crm_notifications_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notifications
    ADD CONSTRAINT crm_notifications_staff_id_crm_staff_id_fk FOREIGN KEY (staff_id) REFERENCES public.crm_staff(id) ON DELETE CASCADE;


--
-- Name: crm_qualification_results crm_qualification_results_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_results
    ADD CONSTRAINT crm_qualification_results_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_qualification_results crm_qualification_results_model_id_crm_qualification_models_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_results
    ADD CONSTRAINT crm_qualification_results_model_id_crm_qualification_models_id_ FOREIGN KEY (model_id) REFERENCES public.crm_qualification_models(id);


--
-- Name: crm_routing_rules crm_routing_rules_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_routing_rules
    ADD CONSTRAINT crm_routing_rules_staff_id_crm_staff_id_fk FOREIGN KEY (staff_id) REFERENCES public.crm_staff(id) ON DELETE SET NULL;


--
-- Name: crm_routing_rules crm_routing_rules_team_id_crm_teams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_routing_rules
    ADD CONSTRAINT crm_routing_rules_team_id_crm_teams_id_fk FOREIGN KEY (team_id) REFERENCES public.crm_teams(id) ON DELETE SET NULL;


--
-- Name: crm_saved_views crm_saved_views_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_saved_views
    ADD CONSTRAINT crm_saved_views_staff_id_crm_staff_id_fk FOREIGN KEY (staff_id) REFERENCES public.crm_staff(id) ON DELETE CASCADE;


--
-- Name: crm_session_revocations crm_session_revocations_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_session_revocations
    ADD CONSTRAINT crm_session_revocations_staff_id_crm_staff_id_fk FOREIGN KEY (staff_id) REFERENCES public.crm_staff(id) ON DELETE CASCADE;


--
-- Name: crm_sla_instances crm_sla_instances_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_sla_instances crm_sla_instances_policy_id_crm_sla_policies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_policy_id_crm_sla_policies_id_fk FOREIGN KEY (policy_id) REFERENCES public.crm_sla_policies(id);


--
-- Name: crm_staff_invites crm_staff_invites_invited_by_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_staff_invites
    ADD CONSTRAINT crm_staff_invites_invited_by_crm_staff_id_fk FOREIGN KEY (invited_by) REFERENCES public.crm_staff(id);


--
-- Name: crm_team_members crm_team_members_staff_id_crm_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_team_members
    ADD CONSTRAINT crm_team_members_staff_id_crm_staff_id_fk FOREIGN KEY (staff_id) REFERENCES public.crm_staff(id) ON DELETE CASCADE;


--
-- Name: crm_team_members crm_team_members_team_id_crm_teams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_team_members
    ADD CONSTRAINT crm_team_members_team_id_crm_teams_id_fk FOREIGN KEY (team_id) REFERENCES public.crm_teams(id) ON DELETE CASCADE;


--
-- Name: crm_template_versions crm_template_versions_template_id_crm_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_template_versions
    ADD CONSTRAINT crm_template_versions_template_id_crm_templates_id_fk FOREIGN KEY (template_id) REFERENCES public.crm_templates(id) ON DELETE CASCADE;


--
-- Name: crm_workflow_executions crm_workflow_executions_inquiry_id_crm_inquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflow_executions
    ADD CONSTRAINT crm_workflow_executions_inquiry_id_crm_inquiries_id_fk FOREIGN KEY (inquiry_id) REFERENCES public.crm_inquiries(id) ON DELETE CASCADE;


--
-- Name: crm_workflow_executions crm_workflow_executions_workflow_id_crm_workflows_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflow_executions
    ADD CONSTRAINT crm_workflow_executions_workflow_id_crm_workflows_id_fk FOREIGN KEY (workflow_id) REFERENCES public.crm_workflows(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

