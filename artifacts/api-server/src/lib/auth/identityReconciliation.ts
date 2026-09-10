export interface StaffIdentityRow {
  staffId: string;
  email: string | null;
  emailNormalized?: string | null;
  authAccountId?: string | null;
}

export interface AuthIdentifierRow {
  accountId: string;
  kind: string;
  value: string | null;
  verified: boolean;
}

export interface UniqueIdentityMatch {
  staffId: string;
  emailNormalized: string;
  accountId: string;
}

export interface MissingIdentityMatch {
  staffId: string;
  emailNormalized: string;
  reason: "no_verified_email_identifier";
}

export interface AmbiguousIdentityMatch {
  staffId: string;
  emailNormalized: string;
  accountIds: string[];
  reason:
    | "multiple_verified_email_identifiers"
    | "multiple_staff_for_verified_email"
    | "account_already_linked_to_staff";
}

export interface IdentityReconciliationReport {
  unique: UniqueIdentityMatch[];
  missing: MissingIdentityMatch[];
  ambiguous: AmbiguousIdentityMatch[];
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function byStaffId<T extends { staffId: string }>(a: T, b: T): number {
  return a.staffId.localeCompare(b.staffId);
}

export function buildIdentityReconciliationReport(params: {
  staff: StaffIdentityRow[];
  identifiers: AuthIdentifierRow[];
}): IdentityReconciliationReport {
  const linkedAccountIds = new Set(
    params.staff
      .map((row) => row.authAccountId)
      .filter((accountId): accountId is string => Boolean(accountId)),
  );
  const unlinkedStaffEmailCounts = new Map<string, number>();
  for (const row of params.staff) {
    if (row.authAccountId) continue;
    const email = normalizeEmail(row.emailNormalized) || normalizeEmail(row.email);
    if (!email) continue;
    unlinkedStaffEmailCounts.set(email, (unlinkedStaffEmailCounts.get(email) ?? 0) + 1);
  }

  const verifiedEmailAccounts = new Map<string, Set<string>>();
  for (const identifier of params.identifiers) {
    if (identifier.kind !== "email" || !identifier.verified) continue;
    const email = normalizeEmail(identifier.value);
    if (!email) continue;
    const accounts = verifiedEmailAccounts.get(email) ?? new Set<string>();
    accounts.add(identifier.accountId);
    verifiedEmailAccounts.set(email, accounts);
  }

  const unique: UniqueIdentityMatch[] = [];
  const missing: MissingIdentityMatch[] = [];
  const ambiguous: AmbiguousIdentityMatch[] = [];

  for (const row of params.staff) {
    if (row.authAccountId) continue;
    const emailNormalized = normalizeEmail(row.emailNormalized) || normalizeEmail(row.email);
    if (!emailNormalized) {
      missing.push({ staffId: row.staffId, emailNormalized, reason: "no_verified_email_identifier" });
      continue;
    }
    const accountIds = [...(verifiedEmailAccounts.get(emailNormalized) ?? [])].sort();
    if (accountIds.length === 0) {
      missing.push({ staffId: row.staffId, emailNormalized, reason: "no_verified_email_identifier" });
    } else if (accountIds.length === 1) {
      if (linkedAccountIds.has(accountIds[0])) {
        ambiguous.push({
          staffId: row.staffId,
          emailNormalized,
          accountIds,
          reason: "account_already_linked_to_staff",
        });
      } else if ((unlinkedStaffEmailCounts.get(emailNormalized) ?? 0) > 1) {
        ambiguous.push({
          staffId: row.staffId,
          emailNormalized,
          accountIds,
          reason: "multiple_staff_for_verified_email",
        });
      } else {
        unique.push({ staffId: row.staffId, emailNormalized, accountId: accountIds[0] });
      }
    } else {
      ambiguous.push({
        staffId: row.staffId,
        emailNormalized,
        accountIds,
        reason: "multiple_verified_email_identifiers",
      });
    }
  }

  return {
    unique: unique.sort(byStaffId),
    missing: missing.sort(byStaffId),
    ambiguous: ambiguous.sort(byStaffId),
  };
}
