import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export type JsonMap = Record<string, unknown>;

export const crmCompaniesTable = pgTable(
  "crm_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    country: text("country"),
    website: text("website"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index("crm_companies_name_idx").on(t.nameNormalized),
    nameUniq: uniqueIndex("crm_companies_name_uniq").on(t.nameNormalized),
  }),
);

export const crmContactsTable = pgTable(
  "crm_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => crmCompaniesTable.id, {
      onDelete: "set null",
    }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    jobTitle: text("job_title").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    country: text("country").notNull(),
    phoneRaw: text("phone_raw"),
    phoneCountry: text("phone_country"),
    phoneCountryCallingCode: text("phone_country_calling_code"),
    phoneNationalNumber: text("phone_national_number"),
    phoneE164: text("phone_e164"),
    phoneValidationStatus: text("phone_validation_status"),
    phoneType: text("phone_type"),
    locale: text("locale"),
    lifecycleStage: text("lifecycle_stage").notNull().default("contact"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUniq: uniqueIndex("crm_contacts_email_uniq").on(t.emailNormalized),
    phoneIdx: index("crm_contacts_phone_e164_idx").on(t.phoneE164),
    companyIdx: index("crm_contacts_company_idx").on(t.companyId),
  }),
);

export const crmInquiryCountersTable = pgTable("crm_inquiry_counters", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

export const crmInquiriesTable = pgTable(
  "crm_inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => crmContactsTable.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references(() => crmCompaniesTable.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("NEW"),
    priority: text("priority").notNull().default("normal"),
    source: text("source").notNull().default("website"),
    channel: text("channel").notNull().default("web_form"),
    inquiryType: text("inquiry_type").notNull().default("sales"),
    useCaseKeys: jsonb("use_case_keys").$type<string[]>().notNull().default([]),
    useCaseOther: text("use_case_other"),
    assignedTeamId: uuid("assigned_team_id").references(() => crmTeamsTable.id, {
      onDelete: "set null",
    }),
    assignedStaffId: uuid("assigned_staff_id").references(() => crmStaffTable.id, {
      onDelete: "set null",
    }),
    assignedReason: text("assigned_reason"),
    qualificationStatus: text("qualification_status").notNull().default("UNASSESSED"),
    qualificationScore: integer("qualification_score").notNull().default(0),
    qualificationGrade: text("qualification_grade"),
    qualificationModelId: uuid("qualification_model_id"),
    qualificationModelVersion: integer("qualification_model_version"),
    systemQualificationStatus: text("system_qualification_status"),
    humanOverrideStatus: text("human_override_status"),
    humanOverrideReason: text("human_override_reason"),
    humanOverrideBy: uuid("human_override_by"),
    humanOverrideAt: timestamp("human_override_at", { withTimezone: true }),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastCustomerMessageAt: timestamp("last_customer_message_at", {
      withTimezone: true,
    }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    meetingOfferedAt: timestamp("meeting_offered_at", { withTimezone: true }),
    spamScore: integer("spam_score").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    attribution: jsonb("attribution").$type<JsonMap>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    refUniq: uniqueIndex("crm_inquiries_reference_uniq").on(t.reference),
    createdIdx: index("crm_inquiries_created_idx").on(t.createdAt),
    statusIdx: index("crm_inquiries_status_idx").on(t.status, t.createdAt),
    qualIdx: index("crm_inquiries_qual_idx").on(t.qualificationStatus, t.createdAt),
    assignedIdx: index("crm_inquiries_assigned_idx").on(t.assignedStaffId, t.status),
    contactIdx: index("crm_inquiries_contact_idx").on(t.contactId, t.createdAt),
    activityIdx: index("crm_inquiries_activity_idx").on(t.lastActivityAt),
    idemUniq: uniqueIndex("crm_inquiries_idempotency_uniq").on(t.idempotencyKey),
  }),
);

export const crmChannelAccountsTable = pgTable(
  "crm_channel_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: text("channel").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    displayName: text("display_name").notNull(),
    connectionStatus: text("connection_status").notNull(),
    capabilities: jsonb("capabilities").$type<JsonMap>().notNull().default({}),
    credentialRef: text("credential_ref"),
    subscriptionStatus: text("subscription_status"),
    subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
    lastError: text("last_error"),
    configurationVersion: integer("configuration_version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    missingRequirements: jsonb("missing_requirements").$type<string[]>().notNull().default([]),
    liveVerifiedAt: timestamp("live_verified_at", { withTimezone: true }),
    verificationEvidence: jsonb("verification_evidence").$type<JsonMap>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelProviderUniq: uniqueIndex("crm_channel_accounts_channel_provider_uniq").on(
      t.channel,
      t.providerAccountId,
    ),
    statusIdx: index("crm_channel_accounts_status_idx").on(t.connectionStatus, t.enabled),
  }),
);

export const crmChannelIdentitiesTable = pgTable(
  "crm_channel_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => crmContactsTable.id, { onDelete: "restrict" }),
    channel: text("channel").notNull(),
    providerAccountContext: text("provider_account_context").notNull().default(""),
    providerUserId: text("provider_user_id").notNull(),
    normalizedEmail: text("normalized_email"),
    normalizedPhone: text("normalized_phone"),
    handle: text("handle"),
    displayName: text("display_name"),
    verificationStatus: text("verification_status").notNull().default("provisional"),
    confidence: text("confidence").notNull().default("low"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    mergeProvenance: jsonb("merge_provenance").$type<JsonMap>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerUserUniq: uniqueIndex("crm_channel_identities_provider_user_uniq").on(
      t.channel,
      t.providerAccountContext,
      t.providerUserId,
    ),
    contactIdx: index("crm_channel_identities_contact_idx").on(t.contactId),
    emailIdx: index("crm_channel_identities_email_idx").on(t.normalizedEmail),
    phoneIdx: index("crm_channel_identities_phone_idx").on(t.normalizedPhone),
  }),
);

export const crmPendingDeliveriesTable = pgTable(
  "crm_pending_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelAccountId: uuid("channel_account_id")
      .notNull()
      .references(() => crmChannelAccountsTable.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    status: text("status").notNull(),
    failureClass: text("failure_class"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountMessageUniq: uniqueIndex("crm_pending_deliveries_account_message_uniq").on(
      t.channelAccountId,
      t.providerMessageId,
    ),
  }),
);

export const crmConversationsTable = pgTable(
  "crm_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("web_form"),
    status: text("status").notNull().default("open"),
    channelAccountId: uuid("channel_account_id").references(() => crmChannelAccountsTable.id, {
      onDelete: "set null",
    }),
    externalThreadId: text("external_thread_id"),
    contactId: uuid("contact_id").references(() => crmContactsTable.id, { onDelete: "set null" }),
    subject: text("subject"),
    priority: text("priority").notNull().default("normal"),
    assignedTeamId: uuid("assigned_team_id").references(() => crmTeamsTable.id, {
      onDelete: "set null",
    }),
    assignedStaffId: uuid("assigned_staff_id").references(() => crmStaffTable.id, {
      onDelete: "set null",
    }),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    lockVersion: integer("lock_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inquiryIdx: index("crm_conversations_inquiry_idx").on(t.inquiryId),
    channelStatusIdx: index("crm_conversations_channel_status_idx").on(
      t.channel,
      t.status,
      t.lastMessageAt,
    ),
  }),
);

export const crmMessagesTable = pgTable(
  "crm_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => crmConversationsTable.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    visibility: text("visibility").notNull().default("customer"),
    channel: text("channel").notNull().default("web_form"),
    authorType: text("author_type").notNull(),
    authorStaffId: uuid("author_staff_id"),
    authorContactId: uuid("author_contact_id"),
    subject: text("subject"),
    body: text("body").notNull(),
    bodyHtml: text("body_html"),
    textBody: text("text_body"),
    sanitizedHtml: text("sanitized_html"),
    templateId: uuid("template_id"),
    templateVersionId: uuid("template_version_id"),
    /** RFC 5322 Message-ID for outbound/inbound email threading. */
    messageId: text("message_id"),
    externalMessageId: text("external_message_id"),
    inReplyTo: text("in_reply_to"),
    referencesHeader: text("references_header"),
    providerMessageId: text("provider_message_id"),
    providerEventId: text("provider_event_id"),
    deliveryStatus: text("delivery_status"),
    bounceType: text("bounce_type"),
    complaintType: text("complaint_type"),
    forwardedTo: text("forwarded_to"),
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<JsonMap>(),
    direction: text("direction").notNull().default("inbound"),
    channelAccountId: uuid("channel_account_id").references(() => crmChannelAccountsTable.id, {
      onDelete: "set null",
    }),
    providerReplyToId: text("provider_reply_to_id"),
    senderJson: jsonb("sender_json").$type<JsonMap>(),
    recipientsJson: jsonb("recipients_json").$type<JsonMap>(),
    attachmentRefs: jsonb("attachment_refs").$type<JsonMap[]>().notNull().default([]),
    providerTimestamp: timestamp("provider_timestamp", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    correlationId: text("correlation_id"),
    causationId: text("causation_id"),
    failureClass: text("failure_class"),
    providerMetadata: jsonb("provider_metadata").$type<JsonMap>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inquiryCreatedIdx: index("crm_messages_inquiry_created_idx").on(
      t.inquiryId,
      t.createdAt,
    ),
    conversationIdx: index("crm_messages_conversation_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    externalIdx: index("crm_messages_external_idx").on(t.externalMessageId),
    messageIdUniq: uniqueIndex("crm_messages_message_id_uniq").on(t.messageId),
    providerEventUniq: uniqueIndex("crm_messages_provider_event_id_uniq").on(
      t.providerEventId,
    ),
    providerMessageIdx: index("crm_messages_provider_message_idx").on(
      t.providerMessageId,
    ),
  }),
);

export const crmInquiryAnswersTable = pgTable(
  "crm_inquiry_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    optionKeys: jsonb("option_keys").$type<string[]>().notNull().default([]),
    freeText: text("free_text"),
  },
  (t) => ({
    inquiryQuestionUniq: uniqueIndex("crm_answers_inquiry_question_uniq").on(
      t.inquiryId,
      t.questionKey,
    ),
    questionIdx: index("crm_answers_question_idx").on(t.questionKey),
  }),
);

export const crmConsentRecordsTable = pgTable(
  "crm_consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => crmContactsTable.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id").references(() => crmInquiriesTable.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    granted: boolean("granted").notNull(),
    termsVersion: text("terms_version"),
    privacyPolicyVersion: text("privacy_policy_version"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contactIdx: index("crm_consent_contact_idx").on(t.contactId, t.createdAt),
  }),
);

export const crmStaffTable = pgTable(
  "crm_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id"),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("sales"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    teamId: uuid("team_id"),
    status: text("status").notNull().default("active"),
    region: text("region"),
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    specialties: jsonb("specialties").$type<string[]>().notNull().default([]),
    capacityLimit: integer("capacity_limit"),
    oooUntil: timestamp("ooo_until", { withTimezone: true }),
    oooReason: text("ooo_reason"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUniq: uniqueIndex("crm_staff_email_uniq").on(t.emailNormalized),
    clerkUniq: uniqueIndex("crm_staff_clerk_uniq").on(t.clerkUserId),
  }),
);

export const crmTeamsTable = pgTable(
  "crm_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    region: text("region"),
    roundRobinCursor: integer("round_robin_cursor").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUniq: uniqueIndex("crm_teams_slug_uniq").on(t.slug),
  }),
);

export const crmTeamMembersTable = pgTable(
  "crm_team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => crmTeamsTable.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => crmStaffTable.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(1),
    active: boolean("active").notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.staffId] }),
  }),
);

export const crmInquiryReadsTable = pgTable(
  "crm_inquiry_reads",
  {
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => crmStaffTable.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.inquiryId, t.staffId] }),
  }),
);

export const crmTagsTable = pgTable(
  "crm_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    color: text("color"),
  },
  (t) => ({
    slugUniq: uniqueIndex("crm_tags_slug_uniq").on(t.slug),
  }),
);

export const crmInquiryTagsTable = pgTable(
  "crm_inquiry_tags",
  {
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => crmTagsTable.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.inquiryId, t.tagId] }),
  }),
);

export const crmTaxonomyTable = pgTable(
  "crm_taxonomy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    parentKey: text("parent_key").notNull().default(""),
    label: text("label").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    metadata: jsonb("metadata").$type<JsonMap>(),
  },
  (t) => ({
    scopeUniq: uniqueIndex("crm_taxonomy_scope_uniq").on(t.kind, t.parentKey, t.key),
    kindIdx: index("crm_taxonomy_kind_idx").on(t.kind, t.sortOrder),
  }),
);

export const crmQualificationModelsTable = pgTable("crm_qualification_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull().default("published"),
  thresholds: jsonb("thresholds").$type<JsonMap>().notNull(),
  rules: jsonb("rules").$type<JsonMap[]>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmQualificationResultsTable = pgTable(
  "crm_qualification_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    modelId: uuid("model_id").references(() => crmQualificationModelsTable.id),
    modelVersion: integer("model_version").notNull(),
    score: integer("score").notNull(),
    grade: text("grade"),
    status: text("status").notNull(),
    reasons: jsonb("reasons").$type<JsonMap[]>().notNull(),
    source: text("source").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inquiryIdx: index("crm_qual_results_inquiry_idx").on(t.inquiryId, t.createdAt),
  }),
);

export const crmAiClassificationsTable = pgTable("crm_ai_classifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  inquiryId: uuid("inquiry_id")
    .notNull()
    .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model"),
  confidence: integer("confidence"),
  output: jsonb("output").$type<JsonMap>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmTemplatesTable = pgTable(
  "crm_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    internalName: text("internal_name").notNull(),
    description: text("description"),
    category: text("category").notNull().default("acknowledgment"),
    channel: text("channel").notNull().default("email"),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUniq: uniqueIndex("crm_templates_key_uniq").on(t.key),
  }),
);

export const crmTemplateVersionsTable = pgTable(
  "crm_template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => crmTemplatesTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    language: text("language").notNull().default("en"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    changeSummary: text("change_summary"),
    changedBy: uuid("changed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    templateLangVerUniq: uniqueIndex("crm_template_ver_uniq").on(
      t.templateId,
      t.language,
      t.versionNumber,
    ),
  }),
);

export const crmMacrosTable = pgTable(
  "crm_macros",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    actions: jsonb("actions").$type<JsonMap[]>().notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUniq: uniqueIndex("crm_macros_key_uniq").on(t.key),
  }),
);

export const crmWorkflowsTable = pgTable(
  "crm_workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    trigger: text("trigger").notNull(),
    conditions: jsonb("conditions").$type<JsonMap[]>().notNull().default([]),
    actions: jsonb("actions").$type<JsonMap[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUniq: uniqueIndex("crm_workflows_key_uniq").on(t.key),
  }),
);

export const crmWorkflowExecutionsTable = pgTable(
  "crm_workflow_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => crmWorkflowsTable.id, { onDelete: "cascade" }),
    workflowVersion: integer("workflow_version").notNull(),
    inquiryId: uuid("inquiry_id").references(() => crmInquiriesTable.id, {
      onDelete: "cascade",
    }),
    trigger: text("trigger").notNull(),
    matched: jsonb("matched").$type<JsonMap>(),
    status: text("status").notNull(),
    error: text("error"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idemUniq: uniqueIndex("crm_workflow_exec_idem_uniq").on(t.idempotencyKey),
    inquiryIdx: index("crm_workflow_exec_inquiry_idx").on(t.inquiryId, t.createdAt),
  }),
);

export const crmRoutingRulesTable = pgTable("crm_routing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  priority: integer("priority").notNull().default(100),
  status: text("status").notNull().default("active"),
  conditions: jsonb("conditions").$type<JsonMap[]>().notNull().default([]),
  strategy: text("strategy").notNull().default("team"),
  teamId: uuid("team_id").references(() => crmTeamsTable.id, {
    onDelete: "set null",
  }),
  staffId: uuid("staff_id").references(() => crmStaffTable.id, {
    onDelete: "set null",
  }),
  reasonTemplate: text("reason_template"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmSlaPoliciesTable = pgTable("crm_sla_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("active"),
  firstResponseMinutes: integer("first_response_minutes").notNull(),
  nextResponseMinutes: integer("next_response_minutes"),
  resolutionMinutes: integer("resolution_minutes"),
  conditions: jsonb("conditions").$type<JsonMap[]>().notNull().default([]),
  holidays: jsonb("holidays").$type<string[]>().notNull().default([]),
  timeZone: text("time_zone").notNull().default("UTC"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmSlaInstancesTable = pgTable(
  "crm_sla_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => crmSlaPoliciesTable.id),
    policyVersion: integer("policy_version").notNull(),
    measure: text("measure").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("ON_TRACK"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    remainingMs: integer("remaining_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inquiryIdx: index("crm_sla_inquiry_idx").on(t.inquiryId, t.status),
    dueIdx: index("crm_sla_due_idx").on(t.dueAt, t.status),
  }),
);

export const crmMeetingTypesTable = pgTable(
  "crm_meeting_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    timezone: text("timezone").notNull().default("UTC"),
    bookingUrl: text("booking_url").notNull(),
    teamId: uuid("team_id"),
    calendarSource: text("calendar_source").notNull().default("external"),
    status: text("status").notNull().default("active"),
  },
  (t) => ({
    keyUniq: uniqueIndex("crm_meeting_types_key_uniq").on(t.key),
  }),
);

export const crmMeetingsTable = pgTable(
  "crm_meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id").references(() => crmInquiriesTable.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => crmContactsTable.id, {
      onDelete: "set null",
    }),
    meetingTypeId: uuid("meeting_type_id").references(() => crmMeetingTypesTable.id),
    assignedStaffId: uuid("assigned_staff_id"),
    assignedTeamId: uuid("assigned_team_id"),
    bookingUrl: text("booking_url").notNull(),
    bookingStatus: text("booking_status").notNull().default("INVITED"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    rescheduledAt: timestamp("rescheduled_at", { withTimezone: true }),
    externalBookingId: text("external_booking_id"),
    timezone: text("timezone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inquiryIdx: index("crm_meetings_inquiry_idx").on(t.inquiryId),
    contactIdx: index("crm_meetings_contact_idx").on(t.contactId),
  }),
);

export const crmNotificationsTable = pgTable(
  "crm_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => crmStaffTable.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id").references(() => crmInquiriesTable.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    staffUnreadIdx: index("crm_notifications_staff_idx").on(t.staffId, t.createdAt),
  }),
);

export const crmSavedViewsTable = pgTable("crm_saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id")
    .notNull()
    .references(() => crmStaffTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<JsonMap>().notNull(),
  columns: jsonb("columns").$type<string[]>(),
  sort: jsonb("sort").$type<JsonMap>(),
  isDefault: boolean("is_default").notNull().default(false),
  scope: text("scope").notNull().default("personal"),
  teamId: uuid("team_id").references(() => crmTeamsTable.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => crmStaffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmLegalHoldsTable = pgTable(
  "crm_legal_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").references(() => crmContactsTable.id, {
      onDelete: "cascade",
    }),
    inquiryId: uuid("inquiry_id").references(() => crmInquiriesTable.id, {
      onDelete: "cascade",
    }),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => crmStaffTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => ({
    contactIdx: index("crm_legal_holds_contact_idx").on(t.contactId, t.releasedAt),
    inquiryIdx: index("crm_legal_holds_inquiry_idx").on(t.inquiryId, t.releasedAt),
  }),
);

export const crmEmailQuarantineTable = pgTable(
  "crm_email_quarantine",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reason: text("reason").notNull(),
    subject: text("subject"),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    payload: jsonb("payload").$type<JsonMap>(),
    status: text("status").notNull().default("open"),
    reconciledInquiryId: uuid("reconciled_inquiry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("crm_email_quarantine_status_idx").on(t.status, t.createdAt),
  }),
);

export const crmSessionRevocationsTable = pgTable(
  "crm_session_revocations",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => crmStaffTable.id, { onDelete: "cascade" }),
    revokedBefore: timestamp("revoked_before", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.staffId] }),
  }),
);

export const crmStaffInvitesTable = pgTable(
  "crm_staff_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailNormalized: text("email_normalized").notNull(),
    role: text("role").notNull().default("sales"),
    invitedBy: uuid("invited_by").references(() => crmStaffTable.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUniq: uniqueIndex("crm_staff_invites_email_uniq").on(t.emailNormalized),
  }),
);

export const crmAuditEventsTable = pgTable(
  "crm_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    inquiryId: uuid("inquiry_id"),
    contactId: uuid("contact_id"),
    beforeValue: jsonb("before_value").$type<JsonMap>(),
    afterValue: jsonb("after_value").$type<JsonMap>(),
    workflowId: uuid("workflow_id"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("crm_audit_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    inquiryIdx: index("crm_audit_inquiry_idx").on(t.inquiryId, t.createdAt),
    actionIdx: index("crm_audit_action_idx").on(t.action, t.createdAt),
  }),
);

export const crmJobsTable = pgTable(
  "crm_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<JsonMap>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    correlationId: text("correlation_id"),
    causationId: text("causation_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    claimGeneration: integer("claim_generation").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    statusRunIdx: index("crm_jobs_status_run_idx").on(t.status, t.runAt),
    leaseIdx: index("crm_jobs_lease_idx").on(t.status, t.leaseExpiresAt),
    idempotencyUniq: uniqueIndex("crm_jobs_idempotency_uidx").on(t.idempotencyKey),
  }),
);

export const crmWebhookReceiptsTable = pgTable("crm_webhook_receipts", {
  providerEventId: text("provider_event_id").primaryKey(),
  payloadHash: text("payload_hash").notNull().default(""),
  status: text("status").notNull().default("received"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  claimGeneration: integer("claim_generation").notNull().default(0),
  processingToken: text("processing_token"),
  processingOwner: text("processing_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  terminal: boolean("terminal").notNull().default(false),
  rawPayload: text("raw_payload"),
  payloadEncrypted: boolean("payload_encrypted").notNull().default(false),
  normalizedPayload: jsonb("normalized_payload").$type<JsonMap>(),
  retainedUntil: timestamp("retained_until", { withTimezone: true }),
});

export const crmContactMergesTable = pgTable(
  "crm_contact_merges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    winnerId: uuid("winner_id")
      .notNull()
      .references(() => crmContactsTable.id, { onDelete: "restrict" }),
    loserId: uuid("loser_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    plan: jsonb("plan").$type<JsonMap>().notNull(),
    actorStaffId: text("actor_staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex("crm_contact_merges_idempotency_uidx").on(t.idempotencyKey),
  }),
);

/** Distributed rate-limit counters for multi-replica public endpoints. */
export const crmRateLimitsTable = pgTable(
  "crm_rate_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    windowIdx: index("crm_rate_limits_window_idx").on(t.windowStartedAt),
  }),
);

export const crmAnalyticsEventsTable = pgTable(
  "crm_analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event: text("event").notNull(),
    inquiryId: uuid("inquiry_id"),
    contactId: uuid("contact_id"),
    properties: jsonb("properties").$type<JsonMap>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index("crm_analytics_event_idx").on(t.event, t.createdAt),
    inquiryIdx: index("crm_analytics_inquiry_idx").on(t.inquiryId),
  }),
);

export const crmConfigTable = pgTable("crm_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<JsonMap>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmConfigChangesTable = pgTable(
  "crm_config_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    status: text("status").notNull().default("draft"),
    summary: text("summary"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    beforeValue: jsonb("before_value").$type<JsonMap>(),
    afterValue: jsonb("after_value").$type<JsonMap>().notNull(),
    authorStaffId: uuid("author_staff_id").references(() => crmStaffTable.id),
    reviewerStaffId: uuid("reviewer_staff_id").references(() => crmStaffTable.id),
    publisherStaffId: uuid("publisher_staff_id").references(() => crmStaffTable.id),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lockVersion: integer("lock_version").notNull().default(0),
    publishedVersion: integer("published_version"),
    rollbackOfId: uuid("rollback_of_id"),
    supersedesId: uuid("supersedes_id"),
    emergency: boolean("emergency").notNull().default(false),
    emergencyReason: text("emergency_reason"),
    schemaVersion: integer("schema_version").notNull().default(1),
    rollbackOfPublicationId: uuid("rollback_of_publication_id"),
    supersedesChangeId: uuid("supersedes_change_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("crm_config_changes_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    statusIdx: index("crm_config_changes_status_idx").on(t.status, t.createdAt),
  }),
);

export const crmConfigPublicationsTable = pgTable(
  "crm_config_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    publishedVersion: integer("published_version").notNull(),
    changeId: uuid("change_id")
      .notNull()
      .references(() => crmConfigChangesTable.id, { onDelete: "restrict" }),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => crmConfigPublicationsTable.id, {
      onDelete: "restrict",
    }),
    rollbackOfId: uuid("rollback_of_id").references((): AnyPgColumn => crmConfigPublicationsTable.id, {
      onDelete: "restrict",
    }),
    beforeValue: jsonb("before_value").$type<JsonMap>(),
    afterValue: jsonb("after_value").$type<JsonMap>().notNull(),
    authorStaffId: text("author_staff_id"),
    reviewerStaffId: text("reviewer_staff_id"),
    publisherStaffId: text("publisher_staff_id"),
    emergency: boolean("emergency").notNull().default(false),
    emergencyReason: text("emergency_reason"),
    schemaVersion: integer("schema_version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
  },
  (t) => ({
    streamVersionUniq: uniqueIndex("crm_config_publications_stream_version_uidx").on(
      t.entityType,
      t.entityId,
      t.publishedVersion,
    ),
    streamIdx: index("crm_config_publications_stream_idx").on(t.entityType, t.entityId, t.publishedAt),
  }),
);

export const crmJobEffectsTable = pgTable(
  "crm_job_effects",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    jobId: uuid("job_id").references(() => crmJobsTable.id, { onDelete: "set null" }),
    jobClaimGeneration: integer("job_claim_generation"),
    claimGeneration: integer("claim_generation").notNull().default(0),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    processingToken: text("processing_token"),
    processingOwner: text("processing_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    payloadHash: text("payload_hash"),
    providerIdempotencyKey: text("provider_idempotency_key"),
    providerRequestId: text("provider_request_id"),
    providerMessageId: text("provider_message_id"),
    correlationId: text("correlation_id"),
    causationId: text("causation_id"),
    meta: jsonb("meta").$type<JsonMap>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (t) => ({
    kindIdx: index("crm_job_effects_kind_idx").on(t.kind, t.createdAt),
    statusIdx: index("crm_job_effects_status_idx").on(t.status, t.nextAttemptAt),
    jobIdx: index("crm_job_effects_job_idx").on(t.jobId),
  }),
);

export const crmSchemaMigrationsTable = pgTable("crm_schema_migrations", {
  filename: text("filename").primaryKey(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  appliedBy: text("applied_by"),
  fingerprint: text("fingerprint"),
});

export const crmDsarRequestsTable = pgTable(
  "crm_dsar_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").references(() => crmContactsTable.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references(() => crmCompaniesTable.id, { onDelete: "set null" }),
    requestType: text("request_type").notNull(),
    status: text("status").notNull().default("intake"),
    identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    ownerStaffId: uuid("owner_staff_id").references(() => crmStaffTable.id, { onDelete: "set null" }),
    legalExceptionReason: text("legal_exception_reason"),
    rejectionReason: text("rejection_reason"),
    exportManifest: jsonb("export_manifest").$type<JsonMap>(),
    notes: text("notes"),
    createdByStaffId: text("created_by_staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    contactIdx: index("crm_dsar_contact_idx").on(t.contactId, t.createdAt),
    statusIdx: index("crm_dsar_status_idx").on(t.status, t.dueAt),
  }),
);

export const crmAttachmentsTable = pgTable(
  "crm_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id").references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => crmContactsTable.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => crmCompaniesTable.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id"),
    visibility: text("visibility").notNull().default("internal"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageProvider: text("storage_provider").notNull().default("filesystem"),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    signatureOk: boolean("signature_ok").notNull().default(false),
    malwareStatus: text("malware_status").notNull().default("pending"),
    malwareReason: text("malware_reason"),
    legalHold: boolean("legal_hold").notNull().default(false),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    lockVersion: integer("lock_version").notNull().default(1),
    scanAttempts: integer("scan_attempts").notNull().default(0),
    lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
    uploadedByStaffId: text("uploaded_by_staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  },
  (t) => ({
    inquiryIdx: index("crm_attachments_inquiry_idx").on(t.inquiryId),
    contactIdx: index("crm_attachments_contact_idx").on(t.contactId),
    storageUniq: uniqueIndex("crm_attachments_storage_uidx").on(t.storageKey),
  }),
);

export const crmAttachmentUploadsTable = pgTable(
  "crm_attachment_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id").references(() => crmInquiriesTable.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => crmContactsTable.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => crmCompaniesTable.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id"),
    attachmentId: uuid("attachment_id").references(() => crmAttachmentsTable.id, { onDelete: "set null" }),
    actorStaffId: text("actor_staff_id").notNull(),
    storageProvider: text("storage_provider").notNull().default("filesystem"),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    visibility: text("visibility").notNull().default("internal"),
    expectedSizeBytes: integer("expected_size_bytes").notNull(),
    expectedPartCount: integer("expected_part_count"),
    receivedBytes: integer("received_bytes").notNull().default(0),
    status: text("status").notNull().default("uploading"),
    malwareStatus: text("malware_status").notNull().default("pending"),
    malwareReason: text("malware_reason"),
    lockVersion: integer("lock_version").notNull().default(1),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    legalHold: boolean("legal_hold").notNull().default(false),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    abortedAt: timestamp("aborted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    storageUniq: uniqueIndex("crm_attachment_uploads_storage_uidx").on(t.storageKey),
    statusIdx: index("crm_attachment_uploads_status_idx").on(t.status, t.expiresAt),
    actorIdx: index("crm_attachment_uploads_actor_idx").on(t.actorStaffId, t.createdAt),
  }),
);

export const crmAttachmentUploadPartsTable = pgTable(
  "crm_attachment_upload_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => crmAttachmentUploadsTable.id, { onDelete: "cascade" }),
    partNumber: integer("part_number").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    etag: text("etag"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partUniq: uniqueIndex("crm_attachment_upload_parts_uniq").on(t.uploadId, t.partNumber),
    storageUniq: uniqueIndex("crm_attachment_upload_parts_storage_uidx").on(t.storageKey),
  }),
);

export const crmOpportunitiesTable = pgTable(
  "crm_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id").references(() => crmInquiriesTable.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => crmContactsTable.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references(() => crmCompaniesTable.id, { onDelete: "set null" }),
    stage: text("stage").notNull().default("new"),
    amountCents: integer("amount_cents"),
    currency: text("currency").notNull().default("USD"),
    probability: integer("probability"),
    expectedCloseAt: timestamp("expected_close_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    teamId: uuid("team_id").references(() => crmTeamsTable.id, { onDelete: "set null" }),
    ownerStaffId: uuid("owner_staff_id").references(() => crmStaffTable.id, { onDelete: "set null" }),
    source: text("source"),
    conversionIdempotencyKey: text("conversion_idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
  },
  (t) => ({
    inquiryUniq: uniqueIndex("crm_opportunities_inquiry_uidx").on(t.inquiryId),
    conversionUniq: uniqueIndex("crm_opportunities_conversion_uidx").on(t.conversionIdempotencyKey),
    contactIdx: index("crm_opportunities_contact_idx").on(t.contactId),
  }),
);

export const crmOpportunityStagesTable = pgTable(
  "crm_opportunity_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => crmOpportunitiesTable.id, { onDelete: "cascade" }),
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    actorStaffId: text("actor_staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    oppIdx: index("crm_opportunity_stages_opp_idx").on(t.opportunityId, t.createdAt),
  }),
);

export const crmOutboundSendsTable = pgTable(
  "crm_outbound_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    logicalIntentId: text("logical_intent_id").notNull(),
    effectKey: text("effect_key").notNull(),
    inquiryId: uuid("inquiry_id"),
    templateKey: text("template_key"),
    templateVersionId: uuid("template_version_id"),
    providerIdempotencyKey: text("provider_idempotency_key").notNull(),
    providerRequestId: text("provider_request_id"),
    providerMessageId: text("provider_message_id"),
    recipientHash: text("recipient_hash"),
    contentHash: text("content_hash"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    crmMessageId: uuid("crm_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  },
  (t) => ({
    intentUniq: uniqueIndex("crm_outbound_sends_intent_uidx").on(t.logicalIntentId),
    providerKeyUniq: uniqueIndex("crm_outbound_sends_provider_key_uidx").on(t.providerIdempotencyKey),
    effectIdx: index("crm_outbound_sends_effect_idx").on(t.effectKey),
  }),
);

export const crmGraphMailboxStateTable = pgTable("crm_graph_mailbox_state", {
  mailboxUpn: text("mailbox_upn").primaryKey(),
  subscriptionId: text("subscription_id"),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
  clientStateHash: text("client_state_hash").notNull(),
  deltaLinkEncrypted: text("delta_link_encrypted"),
  deltaLinkFingerprint: text("delta_link_fingerprint"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastNotificationAt: timestamp("last_notification_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmMarketingDocumentsTable = pgTable(
  "crm_marketing_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    contentType: text("content_type").notNull().default("page"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUniq: uniqueIndex("crm_marketing_documents_slug_uniq").on(t.slug),
  }),
);

export const crmMarketingVersionsTable = pgTable(
  "crm_marketing_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => crmMarketingDocumentsTable.id, { onDelete: "cascade" }),
    locale: text("locale").notNull().default("en"),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    summary: text("summary"),
    body: jsonb("body").$type<JsonMap>().notNull().default({}),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    robots: text("robots"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    supersedesVersionId: uuid("supersedes_version_id").references((): AnyPgColumn => crmMarketingVersionsTable.id, {
      onDelete: "set null",
    }),
    authorStaffId: uuid("author_staff_id").references(() => crmStaffTable.id, { onDelete: "set null" }),
    reviewerStaffId: uuid("reviewer_staff_id").references(() => crmStaffTable.id, { onDelete: "set null" }),
    publisherStaffId: uuid("publisher_staff_id").references(() => crmStaffTable.id, { onDelete: "set null" }),
    lockVersion: integer("lock_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docLocaleVersionUniq: uniqueIndex("crm_marketing_versions_doc_locale_version_uniq").on(
      t.documentId,
      t.locale,
      t.version,
    ),
    statusIdx: index("crm_marketing_versions_status_idx").on(t.status, t.scheduledAt),
    publishedIdx: index("crm_marketing_versions_published_idx").on(t.documentId, t.locale, t.publishedAt),
  }),
);

export const crmMarketingAuditTable = pgTable(
  "crm_marketing_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => crmMarketingDocumentsTable.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => crmMarketingVersionsTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    actorStaffId: uuid("actor_staff_id").references(() => crmStaffTable.id, { onDelete: "set null" }),
    beforeValue: jsonb("before_value").$type<JsonMap>(),
    afterValue: jsonb("after_value").$type<JsonMap>(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docIdx: index("crm_marketing_audit_doc_idx").on(t.documentId, t.createdAt),
  }),
);

export const crmRecordLocksTable = pgTable(
  "crm_record_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => crmStaffTable.id, { onDelete: "cascade" }),
    intent: text("intent").notNull().default("edit"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    lockGeneration: integer("lock_generation").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityUniq: uniqueIndex("crm_record_locks_entity_uniq").on(t.entityType, t.entityId),
    leaseIdx: index("crm_record_locks_lease_idx").on(t.leaseExpiresAt),
  }),
);

export const crmRecordPresenceTable = pgTable(
  "crm_record_presence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => crmStaffTable.id, { onDelete: "cascade" }),
    intent: text("intent").notNull().default("view"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    staffEntityUniq: uniqueIndex("crm_record_presence_staff_entity_uniq").on(
      t.staffId,
      t.entityType,
      t.entityId,
    ),
    entityIdx: index("crm_record_presence_entity_idx").on(t.entityType, t.entityId, t.lastSeenAt),
  }),
);

export const crmExportJobsTable = pgTable(
  "crm_export_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => crmStaffTable.id, { onDelete: "cascade" }),
    filters: jsonb("filters").$type<JsonMap>().notNull().default({}),
    columns: jsonb("columns").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("pending"),
    artifactPath: text("artifact_path"),
    error: text("error"),
    rowCount: integer("row_count"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    staffCreatedIdx: index("crm_export_jobs_staff_created_idx").on(t.staffId, t.createdAt),
    statusIdx: index("crm_export_jobs_status_idx").on(t.status, t.createdAt),
  }),
);

export type CrmContact = typeof crmContactsTable.$inferSelect;
export type CrmInquiry = typeof crmInquiriesTable.$inferSelect;
export type CrmStaff = typeof crmStaffTable.$inferSelect;
export type CrmMessage = typeof crmMessagesTable.$inferSelect;
export type CrmExportJob = typeof crmExportJobsTable.$inferSelect;
export type CrmChannelAccount = typeof crmChannelAccountsTable.$inferSelect;
export type CrmChannelIdentity = typeof crmChannelIdentitiesTable.$inferSelect;
