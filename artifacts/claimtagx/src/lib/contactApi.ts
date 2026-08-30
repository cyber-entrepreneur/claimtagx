const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") || "";

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

export interface TaxonomyItem {
  id: string;
  kind: string;
  key: string;
  parentKey: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface CountryOption {
  code: string;
  name: string;
  callingCode: string;
}

export interface ContactBootstrap {
  countries: CountryOption[];
  detectedCountry: string | null;
  countryDetectionSource: string;
  termsVersion: string;
  privacyPolicyVersion: string;
  messageMaxLength: number;
  taxonomy: TaxonomyItem[];
}

export interface SubmitResult {
  reference: string;
  qualified: boolean;
  meetingUrl: string | null;
  firstName: string;
  correlationId?: string;
  error?: string;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function fetchBootstrap(): Promise<ContactBootstrap | null> {
  try {
    const res = await fetch(apiUrl("/api/contact/bootstrap"), { credentials: "omit" });
    if (!res.ok) return null;
    const data = await parseJson<ContactBootstrap>(res);
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

export async function submitInquiry(body: unknown): Promise<SubmitResult> {
  const res = await fetch(apiUrl("/api/contact/inquiries"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(body),
  });
  const data = await parseJson<SubmitResult & { error?: string }>(res);
  if (!res.ok) {
    throw Object.assign(new Error(data.error || "We couldn't submit your inquiry."), {
      correlationId: data.correlationId,
    });
  }
  return data;
}

export async function platformLogin(email: string, accessKey: string, name?: string) {
  const res = await fetch(apiUrl("/api/platform/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, accessKey, name }),
  });
  const data = await parseJson<{ error?: string } & Record<string, unknown>>(res);
  if (!res.ok) throw new Error(data.error || "Sign-in failed");
  return data;
}

export async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  if (res.status === 204) return undefined as T;
  const data = await parseJson<T & { error?: string }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data;
}
