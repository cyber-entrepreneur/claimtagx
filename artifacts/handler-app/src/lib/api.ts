import type {
  AvailableVenue,
  PendingInvitation,
  VenueMemberInfo,
  VenueMembership,
  VenueType,
} from "./types";
import { getApiAuthToken, getApiUrl } from "./api-base";

export interface MeResponse {
  userId: string;
  email: string;
  name: string;
  venues: VenueMembership[];
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getApiAuthToken();
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json",
    ...(init?.headers ?? {}),
  });
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const res = await fetch(getApiUrl(url), {
    credentials: "include",
    ...init,
    headers,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = String(data.error);
    } catch {
      // ignore
    }
    // Attach the HTTP status so callers (e.g. the session gate) can treat a
    // 401 as "signed out" rather than a hard error.
    throw Object.assign(new Error(message), { status: res.status });
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export const fetchMe = (): Promise<MeResponse> => jsonFetch<MeResponse>("/api/me");

export const fetchAvailableVenues = (): Promise<AvailableVenue[]> =>
  jsonFetch<AvailableVenue[]>("/api/me/venues/available");

export const joinVenue = (
  inviteToken: string,
): Promise<{ venues: VenueMembership[]; joined: VenueMembership }> =>
  jsonFetch<{ venues: VenueMembership[]; joined: VenueMembership }>(
    "/api/me/venues",
    {
      method: "POST",
      body: JSON.stringify({ inviteToken }),
    },
  );

export const leaveVenue = (
  code: string,
): Promise<{ venues: VenueMembership[] }> =>
  jsonFetch<{ venues: VenueMembership[] }>(
    `/api/me/venues/${encodeURIComponent(code)}`,
    { method: "DELETE" },
  );

// Email-targeted invitations -------------------------------------------------

export const fetchMyInvitations = (): Promise<PendingInvitation[]> =>
  jsonFetch<PendingInvitation[]>("/api/me/invitations");

export const acceptInvitation = (
  id: string,
): Promise<{ venue: VenueMembership }> =>
  jsonFetch<{ venue: VenueMembership }>(
    `/api/me/invitations/${encodeURIComponent(id)}/accept`,
    { method: "POST" },
  );

export const declineInvitation = (id: string): Promise<null> =>
  jsonFetch<null>(
    `/api/me/invitations/${encodeURIComponent(id)}/decline`,
    { method: "POST" },
  );

// Owner-managed venue admin --------------------------------------------------

export const fetchVenueInvitations = (
  code: string,
): Promise<PendingInvitation[]> =>
  jsonFetch<PendingInvitation[]>(
    `/api/venues/${encodeURIComponent(code)}/invitations`,
  );

export const createVenueInvitation = (
  code: string,
  body: { email: string; role?: "handler" | "supervisor" | "owner" },
): Promise<PendingInvitation> =>
  jsonFetch<PendingInvitation>(
    `/api/venues/${encodeURIComponent(code)}/invitations`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const revokeVenueInvitation = (
  code: string,
  id: string,
): Promise<null> =>
  jsonFetch<null>(
    `/api/venues/${encodeURIComponent(code)}/invitations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );

export const fetchVenueMembers = (
  code: string,
): Promise<VenueMemberInfo[]> =>
  jsonFetch<VenueMemberInfo[]>(
    `/api/venues/${encodeURIComponent(code)}/members`,
  );

// Update a venue's classification (valet/baggage/cloakroom/retail). The
// server enforces owner-only access; the handler app uses the response to
// re-skin Command Center, intake, and aging bands without a manual mode
// toggle.
export const updateVenueSettings = (
  code: string,
  body: { venueType: VenueType },
): Promise<{ venueCode: string; venueType: VenueType }> =>
  jsonFetch<{ venueCode: string; venueType: VenueType }>(
    `/api/venues/${encodeURIComponent(code)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );

export const updateVenueMemberRole = (
  code: string,
  userId: string,
  role: "handler" | "supervisor" | "owner",
): Promise<{ venueCode: string; userId: string; role: string }> =>
  jsonFetch<{ venueCode: string; userId: string; role: string }>(
    `/api/venues/${encodeURIComponent(code)}/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );

export const revokeVenueMember = (
  code: string,
  userId: string,
): Promise<null> =>
  jsonFetch<null>(
    `/api/venues/${encodeURIComponent(code)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );

// Owner-only: rotate this venue's QR signing secret. Any QR tags that were
// printed/issued before the call will fail signature checks afterwards;
// handlers can still release items via manual typed entry until tags are
// reprinted.
export const rotateVenueSigningSecret = (code: string): Promise<null> =>
  jsonFetch<null>(
    `/api/venues/${encodeURIComponent(code)}/signing-secret/rotate`,
    { method: "POST" },
  );

// Owner-only: per-handler weekly hours for the current week,
// computed from the existing shifts table on the server. Handlers in
// overtime are flagged so the UI can highlight them.
export interface VenueShiftReportEntry {
  handlerUserId: string;
  handlerName: string;
  handlerEmail: string;
  role: string;
  minutes: number;
  overtime: boolean;
  overtimeMinutes: number;
  activeShiftId: string | null;
}
export interface VenueShiftReport {
  venueCode: string;
  weekStart: number;
  weekEnd: number;
  overtimeThresholdMinutes: number;
  handlers: VenueShiftReportEntry[];
}
export const fetchVenueShiftReport = (
  code: string,
): Promise<VenueShiftReport> =>
  jsonFetch<VenueShiftReport>(
    `/api/venues/${encodeURIComponent(code)}/shifts/report`,
  );
