export interface ScoreRule {
  id: string;
  signal: string;
  field: string;
  op: "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "contains" | "exists";
  value?: unknown;
  points: number;
  reason: string;
  polarity?: "positive" | "negative" | "neutral";
}

export interface QualificationModelDef {
  key: string;
  name: string;
  version: number;
  thresholds: Record<string, number>;
  rules: ScoreRule[];
}

export interface QualificationReason {
  ruleId: string;
  signal: string;
  points: number;
  reason: string;
  polarity: "positive" | "negative" | "neutral";
  matched: boolean;
}

export interface QualificationOutcome {
  score: number;
  grade: string;
  status: string;
  reasons: QualificationReason[];
  modelKey: string;
  modelVersion: number;
}

import { matchCondition, type Condition } from "./conditions";

function gradeForScore(score: number, thresholds: Record<string, number>): {
  status: string;
  grade: string;
} {
  const high = thresholds.HIGH_PRIORITY ?? 90;
  const sales = thresholds.SALES_QUALIFIED ?? 70;
  const mql = thresholds.MARKETING_QUALIFIED ?? 40;
  if (score >= high) return { status: "HIGH_PRIORITY", grade: "A" };
  if (score >= sales) return { status: "SALES_QUALIFIED", grade: "B" };
  if (score >= mql) return { status: "MARKETING_QUALIFIED", grade: "C" };
  return { status: "UNASSESSED", grade: "D" };
}

export function scoreInquiry(
  facts: Record<string, unknown>,
  model: QualificationModelDef,
): QualificationOutcome {
  const reasons: QualificationReason[] = [];
  let score = 0;
  for (const rule of model.rules) {
    const matched = matchCondition(facts, rule as Condition);
    if (matched) {
      score += rule.points;
      reasons.push({
        ruleId: rule.id,
        signal: rule.signal,
        points: rule.points,
        reason: rule.reason,
        polarity: rule.polarity ?? (rule.points >= 0 ? "positive" : "negative"),
        matched: true,
      });
    }
  }
  const { status, grade } = gradeForScore(score, model.thresholds);
  return {
    score,
    grade,
    status,
    reasons,
    modelKey: model.key,
    modelVersion: model.version,
  };
}

export function isImmediatelyQualified(status: string): boolean {
  return status === "SALES_QUALIFIED" || status === "HIGH_PRIORITY";
}
