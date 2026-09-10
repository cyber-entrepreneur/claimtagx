import {
  ApiError,
  getContactBootstrap,
  getGetContactBootstrapUrl,
  getPlatformAuthLoginUrl,
  getPlatformAuthLogoutUrl,
  getGetPlatformMeUrl,
  getPlatformMe,
  getSubmitContactInquiryUrl,
  platformAuthLogin,
  platformAuthLogout,
  setBaseUrl,
  submitContactInquiry,
  type ContactBootstrap,
  type ContactCountry,
  type ContactSubmitRequest,
  type ContactSubmitResponse,
  type CrmTaxonomyItem,
  type PlatformStaffSession,
} from "@workspace/api-client-react";
export {
  isNetworkUncertainSubmitError,
  mapContactSubmitError,
  type ContactSubmitError,
} from "./contactSubmitErrors";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
if (API_BASE) setBaseUrl(API_BASE);

/** @deprecated Prefer generated `CrmTaxonomyItem`. */
export type TaxonomyItem = CrmTaxonomyItem;
/** @deprecated Prefer generated `ContactCountry`. */
export type CountryOption = ContactCountry;
export type { ContactBootstrap };
export type SubmitResult = ContactSubmitResponse;

/**
 * @deprecated First-party auth uses httpOnly cookie sessions (`credentials:
 * "include"`), so no bearer token getter is required. This is a no-op stub
 * kept only so any lingering importer keeps compiling. Do NOT store or wire
 * session tokens through the browser.
 */
export function setPlatformAuthTokenGetter(
  _getter: (() => Promise<string | null>) | null,
): void {
  // intentionally a no-op — cookie sessions only.
}

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

export async function fetchBootstrap(): Promise<ContactBootstrap | null> {
  try {
    return await getContactBootstrap({ credentials: "omit" });
  } catch {
    return null;
  }
}

export async function submitInquiry(body: unknown): Promise<ContactSubmitResponse> {
  try {
    return await submitContactInquiry(body as ContactSubmitRequest, { credentials: "omit" });
  } catch (err) {
    if (err instanceof ApiError) {
      const data = (err.data ?? {}) as { error?: string; correlationId?: string };
      throw Object.assign(new Error(data.error || "We couldn't submit your inquiry."), {
        status: err.status,
        correlationId: data.correlationId,
      });
    }
    throw err;
  }
}

export async function platformLogin(email: string, password: string) {
  try {
    return await platformAuthLogin({ email, password });
  } catch (err) {
    if (err instanceof ApiError) {
      const data = (err.data ?? {}) as { error?: string };
      throw new Error(data.error || "Sign-in failed");
    }
    throw err;
  }
}

/** Current platform staff session (generated `getPlatformMe`). */
export async function fetchPlatformMe(init?: RequestInit): Promise<PlatformStaffSession> {
  try {
    return await getPlatformMe(init);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }
    throw err;
  }
}

/** Clear platform staff session cookie (generated `platformAuthLogout`). */
export async function platformLogout(init?: RequestInit): Promise<void> {
  await platformAuthLogout(init);
}

export const CONTACT_PATHS = {
  bootstrap: getGetContactBootstrapUrl,
  submit: getSubmitContactInquiryUrl,
  platformLogin: getPlatformAuthLoginUrl,
  platformLogout: getPlatformAuthLogoutUrl,
  platformMe: getGetPlatformMeUrl,
};
