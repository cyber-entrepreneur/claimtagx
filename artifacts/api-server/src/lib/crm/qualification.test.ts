import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreInquiry, isImmediatelyQualified, type QualificationModelDef } from "./qualification";
import { renderTemplate } from "./templates";
import { matchAllConditions } from "./conditions";
import { heuristicClassify } from "./ai";
import { isSeniorJobTitle, buildFacts } from "./facts";

const model: QualificationModelDef = {
  key: "enterprise",
  name: "Enterprise Qualification",
  version: 3,
  thresholds: { HIGH_PRIORITY: 90, SALES_QUALIFIED: 70, MARKETING_QUALIFIED: 40 },
  rules: [
    {
      id: "loc",
      signal: "locations",
      field: "answers.locations",
      op: "in",
      value: ["100_plus"],
      points: 30,
      reason: "Multi-location operation",
    },
    {
      id: "vol",
      signal: "volume",
      field: "answers.volume",
      op: "in",
      value: ["100001_500000"],
      points: 25,
      reason: "High transaction volume",
    },
    {
      id: "time",
      signal: "intent",
      field: "answers.timeline",
      op: "in",
      value: ["1_3_months"],
      points: 20,
      reason: "Implementation within 3 months",
    },
    {
      id: "role",
      signal: "firmographic",
      field: "contact.seniorRole",
      op: "eq",
      value: true,
      points: 10,
      reason: "Senior job role",
    },
  ],
};

test("qualification scores and explains matched rules only", () => {
  const facts = buildFacts({
    country: "LB",
    jobTitle: "Director of Operations",
    useCaseKeys: ["vehicles"],
    answers: {
      locations: ["100_plus"],
      volume: ["100001_500000"],
      timeline: ["1_3_months"],
    },
  });
  const result = scoreInquiry(facts, model);
  assert.equal(result.score, 85);
  assert.equal(result.status, "SALES_QUALIFIED");
  assert.equal(isImmediatelyQualified(result.status), true);
  assert.ok(result.reasons.every((r) => r.matched));
  assert.ok(result.reasons.find((r) => r.reason.includes("Multi-location")));
});

test("just exploring does not qualify and is not treated as spam", () => {
  const facts = buildFacts({
    country: "US",
    jobTitle: "Intern",
    useCaseKeys: ["cloaks"],
    answers: { timeline: ["just_exploring"], locations: ["1"], volume: ["lt_1000"] },
  });
  const result = scoreInquiry(facts, model);
  assert.equal(result.status, "UNASSESSED");
  assert.equal(isImmediatelyQualified(result.status), false);
});

test("template rendering fails safe on missing variables", () => {
  const { text, missing } = renderTemplate(
    "Hello {{contact.first_name}}, ref {{inquiry.reference}} {{unknown.path}}",
    { contact: { first_name: "Ali" }, inquiry: { reference: "CTX-2026-000001" } },
  );
  assert.equal(text.includes("null"), false);
  assert.equal(text.includes("{{"), false);
  assert.ok(text.startsWith("Hello Ali"));
  assert.ok(missing.includes("unknown.path"));
});

test("workflow conditions match qualified facts", () => {
  const { ok } = matchAllConditions(
    { qualification: { immediatelyQualified: true, score: 86 } },
    [
      { field: "qualification.immediatelyQualified", op: "eq", value: true },
      { field: "qualification.score", op: "gte", value: 70 },
    ],
  );
  assert.equal(ok, true);
});

test("senior job title detection", () => {
  assert.equal(isSeniorJobTitle("Head of Valet"), true);
  assert.equal(isSeniorJobTitle("Parking attendant"), false);
});

test("heuristic classifier is a signal not a router", () => {
  const out = heuristicClassify("We operate 40 hotels and need to go live this month.");
  assert.equal(out.potential_enterprise_account, true);
  assert.ok(out.confidence < 80);
});
