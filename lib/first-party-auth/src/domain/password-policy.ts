/**
 * Password policy is a DOMAIN rule, not an adapter concern: the same minimum
 * strength must hold whether a password arrives via registration, reset, or
 * change. Services evaluate a candidate against a {@link PasswordPolicy} and
 * translate any violation into a single `WEAK_PASSWORD` result.
 *
 * The default policy mandates a minimum length only (OWASP treats length as the
 * dominant strength factor and discourages forced composition rules). Hosts may
 * opt into character-class requirements per deployment.
 */

export interface PasswordPolicy {
  /** Minimum number of characters. */
  readonly minLength: number;
  /** Optional upper bound (guards against DoS via absurdly long inputs). */
  readonly maxLength?: number;
  readonly requireLowercase?: boolean;
  readonly requireUppercase?: boolean;
  readonly requireDigit?: boolean;
  readonly requireSymbol?: boolean;
}

export const defaultPasswordPolicy: PasswordPolicy = {
  minLength: 8,
  maxLength: 1024,
};

export type PasswordViolation =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "MISSING_LOWERCASE"
  | "MISSING_UPPERCASE"
  | "MISSING_DIGIT"
  | "MISSING_SYMBOL";

export interface PasswordEvaluation {
  readonly ok: boolean;
  readonly violations: readonly PasswordViolation[];
}

const hasLowercase = (value: string): boolean => /[a-z]/.test(value);
const hasUppercase = (value: string): boolean => /[A-Z]/.test(value);
const hasDigit = (value: string): boolean => /\d/.test(value);
const hasSymbol = (value: string): boolean => /[^A-Za-z0-9]/.test(value);

export const evaluatePassword = (
  password: string,
  policy: PasswordPolicy = defaultPasswordPolicy,
): PasswordEvaluation => {
  const violations: PasswordViolation[] = [];
  if (password.length < policy.minLength) {
    violations.push("TOO_SHORT");
  }
  if (policy.maxLength !== undefined && password.length > policy.maxLength) {
    violations.push("TOO_LONG");
  }
  if (policy.requireLowercase === true && !hasLowercase(password)) {
    violations.push("MISSING_LOWERCASE");
  }
  if (policy.requireUppercase === true && !hasUppercase(password)) {
    violations.push("MISSING_UPPERCASE");
  }
  if (policy.requireDigit === true && !hasDigit(password)) {
    violations.push("MISSING_DIGIT");
  }
  if (policy.requireSymbol === true && !hasSymbol(password)) {
    violations.push("MISSING_SYMBOL");
  }
  return { ok: violations.length === 0, violations };
};

export const isPasswordAcceptable = (
  password: string,
  policy: PasswordPolicy = defaultPasswordPolicy,
): boolean => evaluatePassword(password, policy).ok;

/** Human-readable requirement summary for a `WEAK_PASSWORD` error message. */
export const describePasswordPolicy = (
  policy: PasswordPolicy = defaultPasswordPolicy,
): string => {
  const parts: string[] = [`at least ${policy.minLength} characters`];
  if (policy.requireLowercase === true) parts.push("a lowercase letter");
  if (policy.requireUppercase === true) parts.push("an uppercase letter");
  if (policy.requireDigit === true) parts.push("a digit");
  if (policy.requireSymbol === true) parts.push("a symbol");
  if (policy.maxLength !== undefined) parts.push(`no more than ${policy.maxLength} characters`);
  return `Password must contain ${parts.join(", ")}.`;
};
