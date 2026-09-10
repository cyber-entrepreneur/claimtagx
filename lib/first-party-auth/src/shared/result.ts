/**
 * Explicit-error Result so the core never throws for expected auth failures
 * (bad password, expired code, locked account, MFA required). Adapters may
 * throw for infrastructure faults; the application layer maps those to Result.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/**
 * Auth error codes are a closed, stable set so callers can branch on them
 * (e.g. surface "resend code" on `CODE_EXPIRED`). Never a localized UI string.
 */
export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "IDENTIFIER_TAKEN"
  | "IDENTIFIER_NOT_VERIFIED"
  | "CODE_INVALID"
  | "CODE_EXPIRED"
  | "CODE_MAX_ATTEMPTS"
  | "MFA_REQUIRED"
  | "MFA_INVALID"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "SESSION_REVOKED"
  | "RATE_LIMITED"
  | "SOCIAL_EXCHANGE_FAILED"
  | "WEAK_PASSWORD"
  | "CHALLENGE_INVALID"
  | "CHALLENGE_EXPIRED"
  | "SIGNATURE_INVALID"
  | "NOT_SUPPORTED";

export interface AuthError {
  readonly code: AuthErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const authError = (
  code: AuthErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AuthError => ({ code, message, ...(details ? { details } : {}) });
