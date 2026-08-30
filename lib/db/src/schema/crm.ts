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
    useCaseKeys: jsonb("use_case_keys").$type<string[]>().notNull().default([]),
    useCaseOther: text("use_case_other"),
    assignedTeamId: uuid("assigned_team_id"),
    assignedStaffId: uuid("assigned_staff_id"),
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

export const crmConversationsTable = pgTable(
  "crm_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => crmInquiriesTable.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("web_form"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inquiryIdx: index("crm_conversations_inquiry_idx").on(t.inquiryId),
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
    templateId: uuid("template_id"),
    templateVersionId: uuid("template_version_id"),
    externalMessageId: text("external_message_id"),
    inReplyTo: text("in_reply_to"),
    forwardedTo: text("forwarded_to"),
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<JsonMap>(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    statusRunIdx: index("crm_jobs_status_run_idx").on(t.status, t.runAt),
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

export type CrmContact = typeof crmContactsTable.$inferSelect;
export type CrmInquiry = typeof crmInquiriesTable.$inferSelect;
export type CrmStaff = typeof crmStaffTable.$inferSelect;
export type CrmMessage = typeof crmMessagesTable.$inferSelect;
