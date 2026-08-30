export const PLATFORM_PERMISSIONS = [
  "inquiries.view",
  "inquiries.reply",
  "inquiries.forward",
  "inquiries.note",
  "inquiries.assign",
  "inquiries.status",
  "inquiries.priority",
  "inquiries.tags",
  "inquiries.qualification.override",
  "inquiries.lead_score.view",
  "inquiries.export",
  "inquiries.delete",
  "templates.manage",
  "workflows.manage",
  "routing.manage",
  "sla.manage",
  "meetings.manage",
  "analytics.view",
  "config.manage",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<string, PlatformPermission[]> = {
  owner: [...PLATFORM_PERMISSIONS],
  admin: [
    "inquiries.view",
    "inquiries.reply",
    "inquiries.forward",
    "inquiries.note",
    "inquiries.assign",
    "inquiries.status",
    "inquiries.priority",
    "inquiries.tags",
    "inquiries.qualification.override",
    "inquiries.lead_score.view",
    "inquiries.export",
    "templates.manage",
    "workflows.manage",
    "routing.manage",
    "sla.manage",
    "meetings.manage",
    "analytics.view",
    "config.manage",
  ],
  sales: [
    "inquiries.view",
    "inquiries.reply",
    "inquiries.forward",
    "inquiries.note",
    "inquiries.assign",
    "inquiries.status",
    "inquiries.priority",
    "inquiries.tags",
    "inquiries.lead_score.view",
  ],
  operator: [
    "inquiries.view",
    "inquiries.reply",
    "inquiries.note",
    "inquiries.status",
    "inquiries.tags",
  ],
  analyst: ["inquiries.view", "inquiries.lead_score.view", "analytics.view"],
};

export function hasPermission(
  granted: string[] | undefined,
  needed: PlatformPermission,
): boolean {
  if (!granted) return false;
  return granted.includes(needed) || granted.includes("*");
}
