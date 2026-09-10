import { ROLE_PERMISSIONS, hasPermission } from "./rbac";

export type DataClass = "public" | "internal" | "pii" | "sensitive_pii";

export const FIELD_CLASSIFICATION: Record<string, DataClass> = {
  "contact.email": "pii",
  "contact.phoneE164": "sensitive_pii",
  "contact.name": "pii",
  "inquiry.message": "pii",
  "inquiry.attribution": "internal",
  "consent.record": "sensitive_pii",
};

export function staffCanViewPii(staff: { role: string; permissions?: string[] | null }): boolean {
  const granted =
    staff.permissions && staff.permissions.length > 0
      ? staff.permissions
      : (ROLE_PERMISSIONS[staff.role] ?? []);
  return hasPermission(granted, "inquiries.reply") || hasPermission(granted, "inquiries.export");
}

export function buildCorrectionRequest(input: {
  contactId: string;
  fields: string[];
  reason: string;
}): { contactId: string; fields: string[]; reason: string } {
  const fields = input.fields.map((f) => f.trim()).filter(Boolean);
  if (!fields.length) {
    throw Object.assign(new Error("At least one field is required"), { status: 400 });
  }
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw Object.assign(new Error("Reason must be at least 5 characters"), { status: 400 });
  }
  return { contactId: input.contactId, fields, reason };
}

function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  if (!d) return "[redacted]";
  return `${(u ?? "").slice(0, 1)}***@${d}`;
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return `***${phone.slice(-4)}`;
}

export function redactContactForRole(
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phoneE164: string | null;
  },
  canViewPii: boolean,
) {
  if (canViewPii) return contact;
  return {
    ...contact,
    firstName: contact.firstName.slice(0, 1) + ".",
    lastName: contact.lastName.slice(0, 1) + ".",
    email: maskEmail(contact.email),
    phoneE164: maskPhone(contact.phoneE164),
  };
}
