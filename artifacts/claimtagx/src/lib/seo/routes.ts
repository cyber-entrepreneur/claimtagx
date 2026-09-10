export type PublicRoute = {
  path: string;
  priority: number;
  changefreq?: "weekly" | "monthly" | "yearly";
  localized?: boolean;
};

export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: "/", priority: 1.0, changefreq: "weekly", localized: true },
  { path: "/contact", priority: 0.8, changefreq: "monthly", localized: true },
  { path: "/price", priority: 0.8, changefreq: "monthly", localized: true },
  { path: "/security", priority: 0.8, changefreq: "monthly", localized: true },
  { path: "/demo-ticket", priority: 0.6, changefreq: "monthly", localized: true },
  { path: "/privacy", priority: 0.3, changefreq: "yearly", localized: true },
  { path: "/terms", priority: 0.3, changefreq: "yearly", localized: true },
  { path: "/refund", priority: 0.3, changefreq: "yearly", localized: true },
  { path: "/cookies", priority: 0.3, changefreq: "yearly", localized: true },
  { path: "/gdpr", priority: 0.3, changefreq: "yearly", localized: true },
  { path: "/dpa", priority: 0.3, changefreq: "yearly", localized: true },
  { path: "/aup", priority: 0.3, changefreq: "yearly", localized: true },
];

export const SOLUTION_SLUGS = [
  "valet",
  "dry-cleaning",
  "luggage",
  "repair",
  "hotels",
  "clubs-restaurants",
  "beach-clubs",
  "airlines",
] as const;

export type RedirectRule = {
  from: string;
  to: string;
  status: 301 | 302 | 308;
  reason: string;
};

export const REDIRECT_REGISTRY: RedirectRule[] = [
  { from: "/handler", to: "/handler/", status: 301, reason: "Normalize handler mount path" },
  { from: "/pricing", to: "/price", status: 301, reason: "Legacy pricing URL" },
];
