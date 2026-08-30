export type ConditionOp =
  | "eq"
  | "neq"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "in"
  | "contains"
  | "exists";

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function matchCondition(
  facts: Record<string, unknown>,
  condition: Condition,
): boolean {
  const actual = getPath(facts, condition.field);
  switch (condition.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "eq":
      return actual === condition.value || String(actual) === String(condition.value);
    case "neq":
      return actual !== condition.value && String(actual) !== String(condition.value);
    case "gte":
      return Number(actual) >= Number(condition.value);
    case "lte":
      return Number(actual) <= Number(condition.value);
    case "gt":
      return Number(actual) > Number(condition.value);
    case "lt":
      return Number(actual) < Number(condition.value);
    case "in": {
      const list = Array.isArray(condition.value)
        ? condition.value
        : [condition.value];
      if (Array.isArray(actual)) {
        return actual.some((item) => list.map(String).includes(String(item)));
      }
      return list.map(String).includes(String(actual));
    }
    case "contains":
      if (Array.isArray(actual)) {
        return actual.map(String).includes(String(condition.value));
      }
      return String(actual ?? "")
        .toLowerCase()
        .includes(String(condition.value ?? "").toLowerCase());
    default:
      return false;
  }
}

export function matchAllConditions(
  facts: Record<string, unknown>,
  conditions: Condition[] | undefined | null,
): { ok: boolean; matched: Condition[] } {
  const list = conditions ?? [];
  if (list.length === 0) return { ok: true, matched: [] };
  const matched: Condition[] = [];
  for (const c of list) {
    if (!matchCondition(facts, c)) return { ok: false, matched };
    matched.push(c);
  }
  return { ok: true, matched };
}
