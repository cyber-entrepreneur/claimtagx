/**
 * Reviewed exceptions where admin UI may use a non-JSON generated-client path
 * or a browser navigation, instead of an ordinary Orval JSON operation.
 *
 * Adding a handwritten `/api/platform/` string in claimtagx src requires an
 * entry here plus review. The source gate fails otherwise.
 */
export type ManualTransportReason =
  | "sse"
  | "streamed_upload"
  | "streamed_download"
  | "browser_navigation_expiring_download"
  | "durable_outbound_retry";

export type ManualTransportException = {
  file: string;
  operation: string;
  reason: ManualTransportReason;
  owner: string;
  reviewDate: string;
};

export const PLATFORM_MANUAL_TRANSPORT_EXCEPTIONS: ManualTransportException[] = [
  {
    file: "pages/admin/Analytics.tsx",
    operation: "GET /api/platform/contact/exports/{id}/download",
    reason: "browser_navigation_expiring_download",
    owner: "platform-engineering",
    reviewDate: "2026-09-04",
  },
];
