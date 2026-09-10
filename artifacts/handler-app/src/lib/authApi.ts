// First-party authentication client for the Handler app.
//
// Uses the same platform auth endpoints as Contact Ops and relies entirely on
// httpOnly cookie sessions (`credentials: "include"`). No tokens are stored in
// localStorage/sessionStorage and no Authorization bearer headers are sent.

import { getApiUrl } from "./api-base";

export type HandlerAuthErrorCode =
  | "invalid_credentials"
  | "throttled"
  | "locked"
  | "suspended"
  | "invalid_code"
  | "network"
  | "unknown";

export class HandlerAuthError extends Error {
  readonly code: HandlerAuthErrorCode;
  readonly status?: number;

  constructor(code: HandlerAuthErrorCode, message?: string, status?: number) {
    super(message ?? code);
    this.name = "HandlerAuthError";
    this.code = code;
    this.status = status;
  }
}

export type LoginResult =
  | { status: "authenticated" }
  | { status: "mfa_required"; accountId: string };

function classify(status: number, code: string | undefined): HandlerAuthErrorCode {
  const c = (code ?? "").toLowerCase();
  if (/invalid.*cred|credential/.test(c)) return "invalid_credentials";
  if (/throttl|rate|too.*many/.test(c)) return "throttled";
  if (/lock/.test(c)) return "locked";
  if (/suspend|terminat|disabled|inactive/.test(c)) return "suspended";
  if (/invalid.*code|mfa/.test(c)) return "invalid_code";
  switch (status) {
    case 401:
      return "invalid_credentials";
    case 403:
      return "suspended";
    case 423:
      return "locked";
    case 429:
      return "throttled";
    default:
      return "unknown";
  }
}

interface RawErrorBody {
  error?: string | { code?: string; message?: string };
  code?: string;
  message?: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(getApiUrl(path), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new HandlerAuthError("network", err instanceof Error ? err.message : undefined);
  }

  if (!res.ok) {
    let data: RawErrorBody = {};
    try {
      data = (await res.json()) as RawErrorBody;
    } catch {
      // ignore parse errors
    }
    const serverCode = typeof data.error === "object" ? data.error?.code : data.code;
    const serverMessage =
      typeof data.error === "string" ? data.error : data.error?.message ?? data.message;
    throw new HandlerAuthError(classify(res.status, serverCode), serverMessage, res.status);
  }

  if (res.status === 204) return null as T;
  try {
    return (await res.json()) as T;
  } catch {
    return null as T;
  }
}

interface RawLoginResponse {
  authenticated?: boolean;
  mfaRequired?: boolean;
  accountId?: string;
}

function normalize(raw: RawLoginResponse): LoginResult {
  if (raw?.mfaRequired && raw.accountId) {
    return { status: "mfa_required", accountId: raw.accountId };
  }
  if (raw?.authenticated) {
    return { status: "authenticated" };
  }
  // Cookie may still be set even if body is minimal.
  return { status: "authenticated" };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return normalize(await post<RawLoginResponse>("/api/platform/auth/login", { email, password }));
}

export async function submitMfaChallenge(
  accountId: string,
  code: string,
): Promise<LoginResult> {
  return normalize(
    await post<RawLoginResponse>("/api/platform/auth/mfa/challenge", {
      accountId,
      method: "totp",
      code,
    }),
  );
}

export async function submitMfaRecovery(
  accountId: string,
  code: string,
): Promise<LoginResult> {
  return normalize(
    await post<RawLoginResponse>("/api/platform/auth/mfa/challenge", {
      accountId,
      method: "recovery",
      code,
    }),
  );
}

export async function logout(): Promise<void> {
  await post<null>("/api/platform/auth/logout", {});
}

export async function logoutAll(): Promise<void> {
  await post<null>("/api/platform/auth/logout-all", {});
}
