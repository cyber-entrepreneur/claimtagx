export type ContactSubmitError = Error & { status?: number; correlationId?: string };

export function isNetworkUncertainSubmitError(err: unknown): boolean {
  const status =
    err instanceof Error && "status" in err ? (err as ContactSubmitError).status : undefined;
  if (status != null) return false;
  const message = err instanceof Error ? err.message : "";
  return /failed to fetch|networkerror|load failed|fetch/i.test(message);
}

export function mapContactSubmitError(
  err: unknown,
  t: (key: string) => string,
): string {
  if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.onLine === false) {
    return t("common.offline");
  }
  if (isNetworkUncertainSubmitError(err)) {
    return t("contact.errors.networkUncertain");
  }
  const status =
    err instanceof Error && "status" in err ? (err as ContactSubmitError).status : undefined;
  switch (status) {
    case 400:
      return t("contact.errors.badRequest");
    case 409:
      return t("contact.errors.conflict");
    case 429:
      return t("contact.errors.rateLimit");
    case 500:
      return t("contact.errors.server");
    case 503:
      return t("contact.errors.unavailable");
    default:
      return err instanceof Error ? err.message : t("contact.errors.submitGeneric");
  }
}
