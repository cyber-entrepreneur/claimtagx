import type { CrmStaff } from "@workspace/db";
import { ROLE_PERMISSIONS, hasPermission, type PlatformPermission } from "./rbac";

export type InquiryAccessAction = "view" | "mutate" | "assign";

export type InquiryAccessRecord = {
  assignedStaffId: string | null;
  assignedTeamId?: string | null;
};

export function effectivePermissions(staff: CrmStaff): string[] {
  if (staff.permissions && staff.permissions.length > 0) return staff.permissions;
  return ROLE_PERMISSIONS[staff.role] ?? [];
}

export function privilegedInquiryAccess(staff: CrmStaff): boolean {
  const granted = effectivePermissions(staff);
  return granted.includes("*") || staff.role === "owner" || staff.role === "admin" || staff.role === "supervisor";
}

export function canViewInquiry(staff: CrmStaff, inquiry: InquiryAccessRecord): boolean {
  if (privilegedInquiryAccess(staff)) return true;
  const granted = effectivePermissions(staff);
  if (!hasPermission(granted as PlatformPermission[], "inquiries.view")) return false;
  if (staff.role === "auditor" || staff.role === "analyst") return true;
  if (inquiry.assignedStaffId === staff.id) return true;
  if (staff.teamId && inquiry.assignedTeamId && inquiry.assignedTeamId === staff.teamId) return true;
  if (!inquiry.assignedStaffId && !inquiry.assignedTeamId) return true;
  return false;
}

/**
 * Object-level inquiry authorization.
 * Owner/admin/supervisor: full access.
 * Auditor: view only.
 * Agent/sales/operator: view team or assigned or unassigned records; mutate only assigned-to-self or unassigned.
 */
export function assertInquiryAccess(
  staff: CrmStaff,
  inquiry: InquiryAccessRecord,
  action: InquiryAccessAction,
): void {
  const granted = effectivePermissions(staff);
  if (privilegedInquiryAccess(staff)) return;
  if (staff.role === "auditor" && action !== "view") {
    throw Object.assign(new Error("Insufficient permission"), { status: 403, code: "OBJECT_AUTH_DENIED" });
  }
  if (action === "view") {
    if (!canViewInquiry(staff, inquiry)) {
      throw Object.assign(new Error("Insufficient permission"), { status: 403, code: "OBJECT_AUTH_DENIED" });
    }
    return;
  }
  if (!canViewInquiry(staff, inquiry)) {
    throw Object.assign(new Error("Insufficient permission"), { status: 403, code: "OBJECT_AUTH_DENIED" });
  }
  if (action === "assign") {
    if (!hasPermission(granted as PlatformPermission[], "inquiries.assign")) {
      throw Object.assign(new Error("Insufficient permission"), { status: 403, code: "OBJECT_AUTH_DENIED" });
    }
    if (
      inquiry.assignedStaffId &&
      inquiry.assignedStaffId !== staff.id &&
      staff.role !== "owner" &&
      staff.role !== "admin"
    ) {
      throw Object.assign(new Error("Inquiry is assigned to another staff member"), {
        status: 403,
        code: "OBJECT_AUTH_DENIED",
      });
    }
    return;
  }
  if (inquiry.assignedStaffId && inquiry.assignedStaffId !== staff.id) {
    throw Object.assign(new Error("Inquiry is assigned to another staff member"), {
      status: 403,
      code: "OBJECT_AUTH_DENIED",
    });
  }
}

export function encodeInquiryCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), i: row.id }), "utf8").toString("base64url");
}

export function decodeInquiryCursor(raw: string): { createdAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: string; i?: string };
    if (!parsed.t || !parsed.i) return null;
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}
