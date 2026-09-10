// First-party authentication client for Contact Ops (CRM admin).
//
// This talks directly to the ClaimTagX platform auth endpoints using cookie
// sessions only. There are NO tokens in localStorage/sessionStorage and NO
// Authorization bearer headers — every request sends `credentials: "include"`
// so the browser attaches the httpOnly session cookie set by the API.
//
// Base URL: existing VITE_API_URL + "/api" (matches the generated client,
// whose paths already include the `/api` prefix on the same origin).

export type StaffRole = string;

export interface StaffSession {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  permissions: string[];
}

export type LoginResult =
  | { status: "authenticated"; staff: StaffSession }
  | { status: "mfa_required"; accountId: string };

/**
 * Normalized auth failure. `code` is a stable, non-enumerating hint the UI can
 * map to a localized message; `status` is the HTTP status when available.
 */
export type AuthErrorCode =
  | "invalid_credentials"
  | "throttled"
  | "locked"
  | "suspended"
  | "session_expired"
  | "invalid_code"
  | "token_invalid"
  | "token_expired"
  | "token_used"
  | "network"
  | "unknown";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: AuthErrorCode,
    message?: string,
    opts?: { status?: number; retryAfterSeconds?: number },
  ) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
    this.status = opts?.status;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
  }
}

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/+$/, "");

function authUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}/api${suffix}`;
}

interface RawErrorBody {
  error?: string | { code?: string; message?: string };
  code?: string;
  message?: string;
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Map a server error code / HTTP status onto a stable AuthErrorCode. */
function classifyError(status: number, serverCode: string | undefined): AuthErrorCode {
  const code = (serverCode ?? "").toLowerCase();
  if (code) {
    if (/invalid.*cred|bad.*cred|credential/.test(code)) return "invalid_credentials";
    if (/throttl|rate|too.*many/.test(code)) return "throttled";
    if (/lock/.test(code)) return "locked";
    if (/suspend|terminat|disabled|inactive/.test(code)) return "suspended";
    if (/expired/.test(code)) return "token_expired";
    if (/used|consumed|already/.test(code)) return "token_used";
    if (/invalid.*token|token.*invalid|not.*found/.test(code)) return "token_invalid";
    if (/invalid.*code|bad.*code|mfa/.test(code)) return "invalid_code";
    if (/session|unauthorized/.test(code)) return "session_expired";
  }
  switch (status) {
    case 400:
      return "token_invalid";
    case 401:
      return "invalid_credentials";
    case 403:
      return "suspended";
    case 404:
      return "token_invalid";
    case 410:
      return "token_expired";
    case 423:
      return "locked";
    case 429:
      return "throttled";
    default:
      return "unknown";
  }
}

async function readErrorBody(res: Response): Promise<RawErrorBody> {
  try {
    return (await res.json()) as RawErrorBody;
  } catch {
    return {};
  }
}

async function request<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(authUrl(path), {
      method: init?.method ?? "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...init,
    });
  } catch (err) {
    throw new AuthError("network", err instanceof Error ? err.message : undefined);
  }

  if (!res.ok) {
    const data = await readErrorBody(res);
    const serverCode =
      typeof data.error === "object" ? data.error?.code : data.code;
    const serverMessage =
      typeof data.error === "string"
        ? data.error
        : data.error?.message ?? data.message;
    throw new AuthError(classifyError(res.status, serverCode), serverMessage, {
      status: res.status,
      retryAfterSeconds: parseRetryAfter(res),
    });
  }

  if (res.status === 204) return null as T;
  try {
    return (await res.json()) as T;
  } catch {
    return null as T;
  }
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

interface RawLoginResponse {
  authenticated?: boolean;
  mfaRequired?: boolean;
  accountId?: string;
  staff?: StaffSession | null;
}

function normalizeLogin(raw: RawLoginResponse): LoginResult {
  if (raw.mfaRequired && raw.accountId) {
    return { status: "mfa_required", accountId: raw.accountId };
  }
  if (raw.authenticated && raw.staff && raw.staff.id && raw.staff.email) {
    return { status: "authenticated", staff: raw.staff };
  }
  // Handler-only accounts can authenticate without a CRM staff row.
  if (raw.authenticated && !raw.staff) {
    throw new AuthError("suspended", "This account is not authorized for Platform Admin.");
  }
  throw new AuthError("unknown");
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const raw = await request<RawLoginResponse>("/platform/auth/login", { email, password });
  return normalizeLogin(raw);
}

export async function submitMfaChallenge(
  accountId: string,
  code: string,
): Promise<LoginResult> {
  const raw = await request<RawLoginResponse>("/platform/auth/mfa/challenge", {
    accountId,
    method: "totp",
    code,
  });
  return normalizeLogin(raw);
}

export async function submitMfaRecovery(
  accountId: string,
  code: string,
): Promise<LoginResult> {
  const raw = await request<RawLoginResponse>("/platform/auth/mfa/challenge", {
    accountId,
    method: "recovery",
    code,
  });
  return normalizeLogin(raw);
}

export async function logout(): Promise<void> {
  await request<null>("/platform/auth/logout", {});
}

export async function logoutAll(): Promise<void> {
  await request<null>("/platform/auth/logout-all", {});
}

/** Always resolves; the server returns a generic success regardless of match. */
export async function forgotPassword(email: string): Promise<void> {
  await request<null>("/platform/auth/forgot-password", { email });
}

/**
 * `token` is the opaque reset link payload: `<challengeId>.<code>` (issued in
 * the password-reset email). The code is never stored in browser storage —
 * it only lives in the URL for the duration of the reset form submit.
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const sep = token.indexOf(".");
  if (sep <= 0 || sep >= token.length - 1) {
    throw new AuthError("token_invalid");
  }
  const challengeId = token.slice(0, sep);
  const code = token.slice(sep + 1);
  await request<null>("/platform/auth/reset-password", {
    challengeId,
    code,
    newPassword: password,
  });
}

export async function acceptInvite(
  token: string,
  password: string,
  name?: string,
): Promise<void> {
  await request<null>("/platform/auth/invite/accept", {
    token,
    password,
    ...(name ? { name } : {}),
  });
}

export async function bootstrap(
  token: string,
  email: string,
  password: string,
  name: string,
): Promise<void> {
  await request<null>("/platform/auth/bootstrap", { token, email, password, name });
}

/** Returns the current staff session, or null when unauthenticated (401). */
export async function fetchSession(init?: RequestInit): Promise<StaffSession | null> {
  try {
    return await request<StaffSession>("/platform/me", undefined, {
      method: "GET",
      ...init,
    });
  } catch (err) {
    if (err instanceof AuthError && (err.status === 401 || err.code === "session_expired")) {
      return null;
    }
    throw err;
  }
}
