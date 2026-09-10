import {
  db,
  crmQualificationModelsTable,
  crmTaxonomyTable,
  crmTemplatesTable,
  crmTemplateVersionsTable,
  crmWorkflowsTable,
  crmSlaPoliciesTable,
  crmTeamsTable,
  crmMeetingTypesTable,
  crmRoutingRulesTable,
  crmMacrosTable,
  crmConfigTable,
  crmTagsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ScoreRule } from "./qualification";

const DEFAULT_RULES: ScoreRule[] = [
  {
    id: "locations_100",
    signal: "locations",
    field: "answers.locations",
    op: "in",
    value: ["100_plus"],
    points: 30,
    reason: "Multi-location operation (100+)",
  },
  {
    id: "locations_51",
    signal: "locations",
    field: "answers.locations",
    op: "in",
    value: ["51_100"],
    points: 22,
    reason: "Multi-location operation (51–100)",
  },
  {
    id: "locations_21",
    signal: "locations",
    field: "answers.locations",
    op: "in",
    value: ["21_50"],
    points: 16,
    reason: "Multi-location operation (21–50)",
  },
  {
    id: "locations_6",
    signal: "locations",
    field: "answers.locations",
    op: "in",
    value: ["6_20"],
    points: 10,
    reason: "Multi-site operation (6–20 locations)",
  },
  {
    id: "volume_500k",
    signal: "volume",
    field: "answers.volume",
    op: "in",
    value: ["500001_plus"],
    points: 30,
    reason: "Very high transaction volume (500k+/month)",
  },
  {
    id: "volume_100k",
    signal: "volume",
    field: "answers.volume",
    op: "in",
    value: ["100001_500000"],
    points: 25,
    reason: "High transaction volume (100k+/month)",
  },
  {
    id: "volume_25k",
    signal: "volume",
    field: "answers.volume",
    op: "in",
    value: ["25001_100000"],
    points: 18,
    reason: "Material transaction volume (25k+/month)",
  },
  {
    id: "volume_5k",
    signal: "volume",
    field: "answers.volume",
    op: "in",
    value: ["5001_25000"],
    points: 10,
    reason: "Meaningful transaction volume (5k+/month)",
  },
  {
    id: "timeline_now",
    signal: "intent",
    field: "answers.timeline",
    op: "in",
    value: ["immediately"],
    points: 28,
    reason: "Immediate implementation intent",
  },
  {
    id: "timeline_1m",
    signal: "intent",
    field: "answers.timeline",
    op: "in",
    value: ["within_1_month"],
    points: 25,
    reason: "Implementation within 1 month",
  },
  {
    id: "timeline_3m",
    signal: "intent",
    field: "answers.timeline",
    op: "in",
    value: ["1_3_months"],
    points: 20,
    reason: "Implementation within 3 months",
  },
  {
    id: "timeline_6m",
    signal: "intent",
    field: "answers.timeline",
    op: "in",
    value: ["3_6_months"],
    points: 10,
    reason: "Implementation within 6 months",
  },
  {
    id: "existing_yes",
    signal: "operational_fit",
    field: "answers.current_solution",
    op: "in",
    value: ["yes", "partially"],
    points: 10,
    reason: "Existing digital solution in place",
  },
  {
    id: "replace_digital",
    signal: "intent",
    field: "answers.objectives",
    op: "contains",
    value: "replace_digital",
    points: 10,
    reason: "Explicit replacement of an existing digital system",
  },
  {
    id: "replace_paper",
    signal: "intent",
    field: "answers.objectives",
    op: "contains",
    value: "replace_paper",
    points: 6,
    reason: "Intent to replace paper claim tickets",
  },
  {
    id: "senior_role",
    signal: "firmographic",
    field: "contact.jobTitle",
    op: "contains",
    value:
      "director|vp|vice|chief|owner|head|manager|founder|president|coo|ceo|cio",
    points: 10,
    reason: "Senior or decision-making job role",
  },
];

// Job-title rule uses contains on a pipe-delimited string; matchCondition
// does substring match which is enough if we store a lowered title and check
// each token in scoreInquiry via a dedicated fact `contact.seniorRole`.
DEFAULT_RULES[DEFAULT_RULES.length - 1] = {
  id: "senior_role",
  signal: "firmographic",
  field: "contact.seniorRole",
  op: "eq",
  value: true,
  points: 10,
  reason: "Senior or decision-making job role",
};

const TAXONOMY: Array<{
  kind: string;
  key: string;
  parentKey?: string;
  label: string;
  sortOrder: number;
}> = [
  { kind: "use_case", key: "vehicles", label: "Vehicles", sortOrder: 10 },
  { kind: "use_case", key: "baggage", label: "Baggage", sortOrder: 20 },
  { kind: "use_case", key: "cloaks", label: "Cloaks", sortOrder: 30 },
  { kind: "use_case", key: "hardware", label: "Hardware", sortOrder: 40 },
  { kind: "use_case", key: "equipment", label: "Equipment", sortOrder: 50 },
  { kind: "use_case", key: "mixed", label: "Mixed Use", sortOrder: 60 },
  { kind: "use_case", key: "other", label: "Other", sortOrder: 70 },

  {
    kind: "question",
    key: "current_solution",
    label: "Do you currently use a digital claim tag or ticketing solution?",
    sortOrder: 10,
  },
  {
    kind: "option",
    key: "yes",
    parentKey: "current_solution",
    label: "Yes",
    sortOrder: 10,
  },
  {
    kind: "option",
    key: "no",
    parentKey: "current_solution",
    label: "No",
    sortOrder: 20,
  },
  {
    kind: "option",
    key: "partially",
    parentKey: "current_solution",
    label: "Partially / in some locations",
    sortOrder: 30,
  },

  {
    kind: "question",
    key: "improvements",
    label: "What would you most like to improve about your current solution?",
    sortOrder: 20,
  },
  { kind: "option", key: "customer_experience", parentKey: "improvements", label: "Customer experience", sortOrder: 10 },
  { kind: "option", key: "speed", parentKey: "improvements", label: "Speed of operation", sortOrder: 20 },
  { kind: "option", key: "loss_disputes", parentKey: "improvements", label: "Loss / dispute management", sortOrder: 30 },
  { kind: "option", key: "traceability", parentKey: "improvements", label: "Traceability and auditability", sortOrder: 40 },
  { kind: "option", key: "accountability", parentKey: "improvements", label: "Staff accountability", sortOrder: 50 },
  { kind: "option", key: "reporting", parentKey: "improvements", label: "Reporting and analytics", sortOrder: 60 },
  { kind: "option", key: "integration", parentKey: "improvements", label: "Integration with existing systems", sortOrder: 70 },
  { kind: "option", key: "cost", parentKey: "improvements", label: "Cost", sortOrder: 80 },
  { kind: "option", key: "reliability", parentKey: "improvements", label: "Reliability", sortOrder: 90 },
  { kind: "option", key: "paper_reduction", parentKey: "improvements", label: "Paper reduction", sortOrder: 100 },
  { kind: "option", key: "other", parentKey: "improvements", label: "Other", sortOrder: 110 },

  {
    kind: "question",
    key: "objectives",
    label: "What are you looking to achieve with ClaimTagX?",
    sortOrder: 30,
  },
  { kind: "option", key: "replace_paper", parentKey: "objectives", label: "Replace paper claim tickets", sortOrder: 10 },
  { kind: "option", key: "replace_digital", parentKey: "objectives", label: "Replace an existing digital system", sortOrder: 20 },
  { kind: "option", key: "improve_cx", parentKey: "objectives", label: "Improve customer experience", sortOrder: 30 },
  { kind: "option", key: "improve_traceability", parentKey: "objectives", label: "Improve custody traceability", sortOrder: 40 },
  { kind: "option", key: "reduce_disputes", parentKey: "objectives", label: "Reduce lost-item / lost-key disputes", sortOrder: 50 },
  { kind: "option", key: "improve_accountability", parentKey: "objectives", label: "Improve employee accountability", sortOrder: 60 },
  { kind: "option", key: "operational_visibility", parentKey: "objectives", label: "Improve operational visibility", sortOrder: 70 },
  { kind: "option", key: "improve_reporting", parentKey: "objectives", label: "Improve reporting", sortOrder: 80 },
  { kind: "option", key: "standardize", parentKey: "objectives", label: "Standardize operations across multiple locations", sortOrder: 90 },
  { kind: "option", key: "integrate", parentKey: "objectives", label: "Integrate claim management into another system", sortOrder: 100 },
  { kind: "option", key: "new_operation", parentKey: "objectives", label: "Explore ClaimTagX for a new operation", sortOrder: 110 },
  { kind: "option", key: "other", parentKey: "objectives", label: "Other", sortOrder: 120 },

  {
    kind: "question",
    key: "volume",
    label: "Approximately how many claim tag transactions do you handle?",
    sortOrder: 40,
  },
  { kind: "option", key: "lt_1000", parentKey: "volume", label: "Less than 1,000 / month", sortOrder: 10 },
  { kind: "option", key: "1000_5000", parentKey: "volume", label: "1,000–5,000 / month", sortOrder: 20 },
  { kind: "option", key: "5001_25000", parentKey: "volume", label: "5,001–25,000 / month", sortOrder: 30 },
  { kind: "option", key: "25001_100000", parentKey: "volume", label: "25,001–100,000 / month", sortOrder: 40 },
  { kind: "option", key: "100001_500000", parentKey: "volume", label: "100,001–500,000 / month", sortOrder: 50 },
  { kind: "option", key: "500001_plus", parentKey: "volume", label: "More than 500,000 / month", sortOrder: 60 },
  { kind: "option", key: "not_sure", parentKey: "volume", label: "Not sure", sortOrder: 70 },

  {
    kind: "question",
    key: "locations",
    label: "How many locations would potentially use ClaimTagX?",
    sortOrder: 50,
  },
  { kind: "option", key: "1", parentKey: "locations", label: "1", sortOrder: 10 },
  { kind: "option", key: "2_5", parentKey: "locations", label: "2–5", sortOrder: 20 },
  { kind: "option", key: "6_20", parentKey: "locations", label: "6–20", sortOrder: 30 },
  { kind: "option", key: "21_50", parentKey: "locations", label: "21–50", sortOrder: 40 },
  { kind: "option", key: "51_100", parentKey: "locations", label: "51–100", sortOrder: 50 },
  { kind: "option", key: "100_plus", parentKey: "locations", label: "100+", sortOrder: 60 },
  { kind: "option", key: "not_sure", parentKey: "locations", label: "Not sure", sortOrder: 70 },

  {
    kind: "question",
    key: "timeline",
    label: "When are you considering implementing a solution?",
    sortOrder: 60,
  },
  { kind: "option", key: "immediately", parentKey: "timeline", label: "Immediately", sortOrder: 10 },
  { kind: "option", key: "within_1_month", parentKey: "timeline", label: "Within 1 month", sortOrder: 20 },
  { kind: "option", key: "1_3_months", parentKey: "timeline", label: "1–3 months", sortOrder: 30 },
  { kind: "option", key: "3_6_months", parentKey: "timeline", label: "3–6 months", sortOrder: 40 },
  { kind: "option", key: "6_12_months", parentKey: "timeline", label: "6–12 months", sortOrder: 50 },
  { kind: "option", key: "more_than_12_months", parentKey: "timeline", label: "More than 12 months", sortOrder: 60 },
  { kind: "option", key: "just_exploring", parentKey: "timeline", label: "Just exploring", sortOrder: 70 },
];

export function publicTaxonomyFallback() {
  return TAXONOMY.map((row) => ({
    id: `local:${row.kind}:${row.parentKey ?? ""}:${row.key}`,
    kind: row.kind,
    key: row.key,
    parentKey: row.parentKey ?? "",
    label: row.label,
    sortOrder: row.sortOrder,
    active: true,
  }));
}

async function upsertTaxonomy(): Promise<void> {
  for (const row of TAXONOMY) {
    await db
      .insert(crmTaxonomyTable)
      .values({ ...row, parentKey: row.parentKey ?? "" })
      .onConflictDoNothing({
        target: [crmTaxonomyTable.kind, crmTaxonomyTable.parentKey, crmTaxonomyTable.key],
      });
  }
}

let seeded = false;

export async function ensureCrmSeeded(): Promise<void> {
  if (seeded) return;
  // Production configuration must be applied via versioned migrations / controlled deploy.
  // Runtime seeding remains for empty environments unless explicitly skipped.
  if (process.env.CRM_SKIP_RUNTIME_SEED === "true") {
    seeded = true;
    return;
  }
  await upsertTaxonomy();

  const [team] = await db
    .insert(crmTeamsTable)
    .values({ slug: "sales", name: "Enterprise Sales", region: "global" })
    .onConflictDoNothing({ target: crmTeamsTable.slug })
    .returning();
  const [existingTeam] =
    team
      ? [team]
      : await db
          .select()
          .from(crmTeamsTable)
          .where(eq(crmTeamsTable.slug, "sales"))
          .limit(1);

  const [model] = await db
    .select({ id: crmQualificationModelsTable.id })
    .from(crmQualificationModelsTable)
    .where(
      and(
        eq(crmQualificationModelsTable.key, "enterprise"),
        eq(crmQualificationModelsTable.status, "published"),
      ),
    )
    .limit(1);
  if (!model) {
    await db.insert(crmQualificationModelsTable).values({
      key: "enterprise",
      name: "Enterprise Qualification",
      version: 1,
      status: "published",
      thresholds: {
        HIGH_PRIORITY: 90,
        SALES_QUALIFIED: 70,
        MARKETING_QUALIFIED: 40,
      },
      rules: DEFAULT_RULES as unknown as Record<string, unknown>[],
      publishedAt: new Date(),
    });
  }

  const templates = [
    {
      key: "STANDARD_ACKNOWLEDGMENT",
      internalName: "Standard inquiry acknowledgment",
      category: "acknowledgment",
      subject: "We received your ClaimTagX inquiry {{inquiry.reference}}",
      body: `Thank you, {{contact.first_name}}.

We've received your inquiry and a member of our team will review it shortly.

Reference: {{inquiry.reference}}

A member of our team will respond as soon as possible.

— ClaimTagX`,
    },
    {
      key: "QUALIFIED_LEAD_ACKNOWLEDGMENT",
      internalName: "Qualified lead acknowledgment",
      category: "acknowledgment",
      subject: "Let's discuss your ClaimTagX requirements — {{inquiry.reference}}",
      body: `Thank you, {{contact.first_name}}.

We've received your inquiry for {{company.name}} and would be happy to discuss your requirements.

Choose a convenient time to speak with our team:
{{meeting.booking_url}}

Reference: {{inquiry.reference}}
{{owner.name}}

— ClaimTagX`,
    },
    {
      key: "STAFF_REPLY",
      internalName: "Blank staff reply",
      category: "reply",
      subject: "Re: ClaimTagX Inquiry {{inquiry.reference}}",
      body: `Hi {{contact.first_name}},

{{body}}

Best regards,
{{owner.name}}
ClaimTagX`,
    },
    {
      key: "MEETING_REQUEST",
      internalName: "Meeting request",
      category: "meeting",
      subject: "Schedule a conversation about ClaimTagX — {{inquiry.reference}}",
      body: `Hi {{contact.first_name}},

Based on what you shared, we'd like to walk through how ClaimTagX would fit {{company.name}}.

Please pick a time that works for you:
{{meeting.booking_url}}

Reference: {{inquiry.reference}}

{{owner.name}}
ClaimTagX`,
    },
  ];

  for (const tpl of templates) {
    const [existing] = await db
      .select({ id: crmTemplatesTable.id })
      .from(crmTemplatesTable)
      .where(eq(crmTemplatesTable.key, tpl.key))
      .limit(1);
    if (existing) continue;
    const [created] = await db
      .insert(crmTemplatesTable)
      .values({
        key: tpl.key,
        internalName: tpl.internalName,
        category: tpl.category,
        channel: "email",
        status: "published",
        publishedAt: new Date(),
      })
      .returning();
    await db.insert(crmTemplateVersionsTable).values({
      templateId: created.id,
      versionNumber: 1,
      language: "en",
      subject: tpl.subject,
      body: tpl.body,
      changeSummary: "Initial published version",
    });
  }

  const [wf] = await db
    .select({ id: crmWorkflowsTable.id })
    .from(crmWorkflowsTable)
    .limit(1);
  if (!wf) {
    await db.insert(crmWorkflowsTable).values([
      {
        key: "standard_ack",
        name: "Standard acknowledgment",
        trigger: "inquiry.created",
        conditions: [
          { field: "qualification.immediatelyQualified", op: "eq", value: false },
        ],
        actions: [{ type: "send_template", params: { key: "STANDARD_ACKNOWLEDGMENT" } }],
      },
      {
        key: "qualified_lead",
        name: "Qualified lead engagement",
        trigger: "inquiry.created",
        conditions: [
          { field: "qualification.immediatelyQualified", op: "eq", value: true },
        ],
        actions: [
          { type: "set_priority", params: { priority: "high" } },
          { type: "add_tag", params: { slug: "qualified" } },
          { type: "generate_meeting" },
          {
            type: "send_template",
            params: { key: "QUALIFIED_LEAD_ACKNOWLEDGMENT" },
          },
          { type: "notify_assignee", params: { type: "qualified_lead" } },
        ],
      },
    ]);
  }

  const [sla] = await db
    .select({ id: crmSlaPoliciesTable.id })
    .from(crmSlaPoliciesTable)
    .limit(1);
  if (!sla) {
    await db.insert(crmSlaPoliciesTable).values([
      {
        key: "standard",
        name: "Standard inquiry",
        firstResponseMinutes: 24 * 60,
        nextResponseMinutes: 24 * 60,
        resolutionMinutes: 7 * 24 * 60,
        conditions: [
          { field: "qualification.immediatelyQualified", op: "eq", value: false },
        ],
      },
      {
        key: "qualified_sales",
        name: "Qualified sales lead",
        firstResponseMinutes: 4 * 60,
        nextResponseMinutes: 8 * 60,
        resolutionMinutes: 5 * 24 * 60,
        conditions: [
          { field: "qualification.immediatelyQualified", op: "eq", value: true },
        ],
      },
    ]);
  }

  const [route] = await db
    .select({ id: crmRoutingRulesTable.id })
    .from(crmRoutingRulesTable)
    .limit(1);
  if (!route && existingTeam) {
    await db.insert(crmRoutingRulesTable).values({
      name: "Default sales routing",
      priority: 1000,
      strategy: "round_robin",
      teamId: existingTeam.id,
      reasonTemplate: "Workflow: Default sales routing. Matched: all inquiries.",
    });
    await db.insert(crmRoutingRulesTable).values({
      name: "Qualified enterprise routing",
      priority: 10,
      strategy: "round_robin",
      teamId: existingTeam.id,
      conditions: [
        { field: "qualification.immediatelyQualified", op: "eq", value: true },
      ],
      reasonTemplate:
        "Workflow: Enterprise Lead Routing. Matched: immediately qualified inquiry.",
    });
  }

  const [mt] = await db
    .select({ id: crmMeetingTypesTable.id })
    .from(crmMeetingTypesTable)
    .limit(1);
  if (!mt) {
    const bookingUrl =
      process.env.SCHEDULING_DEFAULT_URL?.trim() ||
      "https://calendly.com/claimtagx/demo";
    await db.insert(crmMeetingTypesTable).values({
      key: "discovery",
      name: "Discovery conversation",
      durationMinutes: 30,
      timezone: "UTC",
      bookingUrl,
      teamId: existingTeam?.id,
      calendarSource: "external",
    });
  }

  const [macro] = await db
    .select({ id: crmMacrosTable.id })
    .from(crmMacrosTable)
    .limit(1);
  if (!macro) {
    await db.insert(crmMacrosTable).values({
      key: "SEND_MEETING_REQUEST",
      name: "Send meeting request",
      description: "Generate scheduling URL, send meeting template, wait on customer",
      actions: [
        { type: "generate_meeting" },
        { type: "send_template", params: { key: "MEETING_REQUEST" } },
        { type: "change_status", params: { status: "WAITING_FOR_CUSTOMER" } },
        { type: "add_tag", params: { slug: "meeting_requested" } },
      ],
    });
  }

  await db
    .insert(crmTagsTable)
    .values([
      { slug: "qualified", label: "Qualified" },
      { slug: "meeting_requested", label: "Meeting requested" },
      { slug: "enterprise", label: "Enterprise" },
    ])
    .onConflictDoNothing();

  await db
    .insert(crmConfigTable)
    .values({
      key: "policies",
      value: {
        termsVersion: "2026-04-20",
        privacyPolicyVersion: "2026-04-20",
        messageMaxLength: 8000,
        defaultLanguage: "en",
      },
    })
    .onConflictDoNothing();

  seeded = true;
}
