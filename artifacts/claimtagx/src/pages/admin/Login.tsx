import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AUTH_DICTIONARIES,
  AUTH_LANG_META,
  readStoredAuthLang,
  storeAuthLang,
  type AuthLang,
  type AuthStrings,
} from "./authI18n";
import {
  AuthError,
  acceptInvite,
  bootstrap,
  fetchSession,
  forgotPassword,
  login,
  resetPassword,
  submitMfaChallenge,
  submitMfaRecovery,
  type StaffSession,
} from "./authApi";

export type SignInReason =
  | "session_expired"
  | "signed_out"
  | "signed_out_all"
  | "suspended";

type View =
  | "signin"
  | "mfa"
  | "recovery"
  | "forgot"
  | "forgot_sent"
  | "reset"
  | "reset_done"
  | "reset_error"
  | "invite"
  | "invite_done"
  | "invite_error"
  | "bootstrap"
  | "bootstrap_error"
  | "bootstrap_done";

interface ParsedEntry {
  view: View;
  token?: string;
  reason?: SignInReason;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 12;

function parseEntry(): ParsedEntry {
  if (typeof window === "undefined") return { view: "signin" };
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? undefined;
  const mode = (params.get("mode") ?? "").toLowerCase();
  const reasonParam = params.get("reason");
  const reason: SignInReason | undefined =
    reasonParam === "session_expired" ||
    reasonParam === "signed_out" ||
    reasonParam === "signed_out_all" ||
    reasonParam === "suspended"
      ? reasonParam
      : undefined;

  const path = pathname.toLowerCase();
  if (path.includes("reset-password") || mode === "reset") {
    return { view: token ? "reset" : "reset_error", token };
  }
  if (path.includes("accept-invite") || path.includes("/invite") || mode === "invite") {
    return { view: token ? "invite" : "invite_error", token };
  }
  if (path.includes("bootstrap") || mode === "bootstrap") {
    return { view: token ? "bootstrap" : "bootstrap_error", token };
  }
  return { view: "signin", reason };
}

/** Map an AuthError to a localized, non-enumerating message. */
function messageForError(err: unknown, t: AuthStrings): string {
  if (err instanceof AuthError) {
    switch (err.code) {
      case "invalid_credentials":
        return t.invalidCredentials;
      case "throttled":
        return t.throttled;
      case "locked":
        return t.locked;
      case "suspended":
        return t.suspended;
      case "session_expired":
        return t.sessionExpired;
      case "invalid_code":
        return t.mfaInvalidCode;
      case "network":
        return t.networkError;
      default:
        return t.genericError;
    }
  }
  return t.genericError;
}

// ---------------------------------------------------------------------------
// Accessible form primitives
// ---------------------------------------------------------------------------

const inputClass =
  "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-paper placeholder:text-ink/60 " +
  "focus:outline-none focus:ring-2 focus:ring-lime focus:border-lime focus:ring-offset-2 focus:ring-offset-obsidian " +
  "aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-400/40";

const labelClass = "block text-xs font-medium text-ink mb-1";
const errorTextClass = "mt-1 text-xs text-red-300";

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric";
  placeholder?: string;
  required?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  maxLength?: number;
}

function TextField({
  id,
  label,
  type = "text",
  name,
  value,
  onChange,
  error,
  autoComplete,
  inputMode,
  placeholder,
  required,
  inputRef,
  maxLength,
}: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        required={required}
        ref={inputRef}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className={errorTextClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PasswordField({
  id,
  label,
  name,
  value,
  onChange,
  error,
  autoComplete,
  required,
  inputRef,
  showLabel,
  hideLabel,
}: FieldProps & { showLabel: string; hideLabel: string }) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} pe-12`}
          autoComplete={autoComplete}
          required={required}
          ref={inputRef}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 end-0 px-3 text-xs text-ink hover:text-paper focus:outline-none focus:ring-2 focus:ring-lime rounded-e-lg"
          aria-pressed={visible}
        >
          {visible ? hideLabel : showLabel}
        </button>
      </div>
      {error ? (
        <p id={errorId} className={errorTextClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface SummaryError {
  id: string;
  message: string;
}

function ErrorSummary({
  title,
  errors,
  summaryRef,
}: {
  title: string;
  errors: SummaryError[];
  summaryRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (errors.length === 0) return null;
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
    >
      <p className="text-sm font-medium text-red-200">{title}</p>
      <ul className="mt-1 list-disc ps-5 text-xs text-red-200 space-y-0.5">
        {errors.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`} className="underline hover:no-underline">
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ServerErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {message}
    </p>
  );
}

function NoticeBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-lime/30 bg-lime/10 px-3 py-2 text-sm text-lime" role="status">
      {message}
    </p>
  );
}

function SubmitButton({
  pending,
  children,
  submittingLabel,
}: {
  pending: boolean;
  children: ReactNode;
  submittingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-lime px-3 py-2.5 font-semibold text-obsidian transition hover:bg-lime/90 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-2 focus:ring-offset-obsidian"
    >
      {pending ? submittingLabel : children}
    </button>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm text-lime underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-lime rounded"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminLogin({
  onAuthed,
  reason: reasonProp,
}: {
  onAuthed: (me: StaffSession) => void;
  reason?: SignInReason;
}) {
  const [entry] = useState<ParsedEntry>(() => parseEntry());
  const [view, setView] = useState<View>(entry.view);
  const [lang, setLang] = useState<AuthLang>(() => readStoredAuthLang());
  const t = AUTH_DICTIONARIES[lang];
  const dir = AUTH_LANG_META[lang].dir;

  const [reason, setReason] = useState<SignInReason | undefined>(
    reasonProp ?? entry.reason,
  );
  const token = entry.token;

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [view]);

  const setLanguage = useCallback((next: AuthLang) => {
    setLang(next);
    storeAuthLang(next);
  }, []);

  // A signed-in reason banner should only show on the sign-in view.
  const reasonNotice = useMemo(() => {
    if (view !== "signin" || !reason) return null;
    switch (reason) {
      case "session_expired":
        return t.sessionExpired;
      case "signed_out":
        return t.signedOutBody;
      case "signed_out_all":
        return t.loggedOutEverywhereBody;
      case "suspended":
        return t.suspended;
      default:
        return null;
    }
  }, [view, reason, t]);

  const clearReason = useCallback(() => setReason(undefined), []);

  const shared = {
    t,
    dir,
    lang,
    onAuthed,
    setView,
    token,
    headingRef,
    clearReason,
  };

  return (
    <div
      dir={dir}
      lang={AUTH_LANG_META[lang].hrefLang}
      className="min-h-screen bg-obsidian text-paper grid place-items-center px-4 py-10"
    >
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-lg font-extrabold">
              Claim<span className="text-lime">TagX</span>
            </p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink">
              {t.workspace}
            </p>
          </div>
          <LangToggle lang={lang} setLang={setLanguage} t={t} />
        </div>

        {reasonNotice ? <NoticeBanner message={reasonNotice} /> : null}

        {view === "signin" && <SignInView {...shared} />}
        {view === "mfa" && <MfaView {...shared} mode="app" />}
        {view === "recovery" && <MfaView {...shared} mode="recovery" />}
        {view === "forgot" && <ForgotView {...shared} />}
        {view === "forgot_sent" && (
          <InfoPanel
            headingRef={headingRef}
            title={t.forgotSentTitle}
            body={t.forgotSentBody}
            actionLabel={t.forgotBackToSignIn}
            onAction={() => setView("signin")}
          />
        )}
        {view === "reset" && <ResetView {...shared} />}
        {view === "reset_done" && (
          <InfoPanel
            headingRef={headingRef}
            title={t.resetSuccessTitle}
            body={t.resetSuccessBody}
            actionLabel={t.goToSignIn}
            onAction={() => goToSignIn(setView)}
          />
        )}
        {view === "reset_error" && (
          <TokenErrorPanel
            headingRef={headingRef}
            title={t.resetInvalidTitle}
            body={t.resetInvalidBody}
            actionLabel={t.resetRequestNew}
            onAction={() => setView("forgot")}
          />
        )}
        {view === "invite" && <InviteView {...shared} />}
        {view === "invite_done" && (
          <InfoPanel
            headingRef={headingRef}
            title={t.inviteSuccessTitle}
            body={t.inviteSuccessBody}
            actionLabel={t.goToSignIn}
            onAction={() => goToSignIn(setView)}
          />
        )}
        {view === "invite_error" && (
          <TokenErrorPanel
            headingRef={headingRef}
            title={t.inviteInvalidTitle}
            body={t.inviteInvalidBody}
            actionLabel={t.goToSignIn}
            onAction={() => goToSignIn(setView)}
          />
        )}
        {view === "bootstrap" && <BootstrapView {...shared} />}
        {view === "bootstrap_done" && (
          <InfoPanel
            headingRef={headingRef}
            title={t.inviteSuccessTitle}
            body={t.inviteSuccessBody}
            actionLabel={t.goToSignIn}
            onAction={() => goToSignIn(setView)}
          />
        )}
        {view === "bootstrap_error" && (
          <TokenErrorPanel
            headingRef={headingRef}
            title={t.bootstrapInvalidTitle}
            body={t.bootstrapInvalidBody}
            actionLabel={t.goToSignIn}
            onAction={() => goToSignIn(setView)}
          />
        )}
      </div>
    </div>
  );
}

function goToSignIn(setView: (v: View) => void) {
  // Drop token/mode query params so a stale reset/invite link doesn't reopen.
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, "", url.toString());
  }
  setView("signin");
}

function LangToggle({
  lang,
  setLang,
  t,
}: {
  lang: AuthLang;
  setLang: (l: AuthLang) => void;
  t: AuthStrings;
}) {
  const next: AuthLang = lang === "en" ? "ar" : "en";
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-ink hover:text-paper focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-2 focus:ring-offset-obsidian"
      aria-label={t.languageToggleLabel}
    >
      {next === "ar" ? t.switchToArabic : t.switchToEnglish}
    </button>
  );
}

// ---------------------------------------------------------------------------
// View: shared props
// ---------------------------------------------------------------------------

interface ViewProps {
  t: AuthStrings;
  dir: "ltr" | "rtl";
  lang: AuthLang;
  onAuthed: (me: StaffSession) => void;
  setView: (v: View) => void;
  token?: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  clearReason: () => void;
}

function ViewHeader({
  headingRef,
  title,
  subtitle,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
        {title}
      </h1>
      {subtitle ? <p className="mt-1 text-sm text-ink">{subtitle}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View: Sign in
// ---------------------------------------------------------------------------

function SignInView({ t, onAuthed, setView, headingRef, clearReason }: ViewProps) {
  const idBase = useId();
  const emailId = `${idBase}-email`;
  const passwordId = `${idBase}-password`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const summaryErrors: SummaryError[] = [];
  if (fieldErrors.email) summaryErrors.push({ id: emailId, message: fieldErrors.email });
  if (fieldErrors.password) summaryErrors.push({ id: passwordId, message: fieldErrors.password });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        clearReason();
        setServerError(null);
        const errs: Record<string, string> = {};
        if (!email.trim()) errs.email = t.emailRequired;
        else if (!EMAIL_RE.test(email.trim())) errs.email = t.emailInvalid;
        if (!password) errs.password = t.passwordRequired;
        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) {
          if (errs.email) emailRef.current?.focus();
          else passwordRef.current?.focus();
          return;
        }
        setPending(true);
        try {
          const result = await login(email.trim(), password);
          if (result.status === "mfa_required") {
            sessionMfaAccountId = result.accountId;
            setView("mfa");
          } else {
            onAuthed(result.staff);
          }
        } catch (err) {
          setServerError(messageForError(err, t));
          requestAnimationFrame(() => summaryRef.current?.focus());
        } finally {
          setPending(false);
        }
      }}
    >
      <ViewHeader headingRef={headingRef} title={t.signInTitle} subtitle={t.signInSubtitle} />
      <ErrorSummary title={t.errorSummaryTitle} errors={summaryErrors} summaryRef={summaryRef} />
      <ServerErrorBanner message={serverError} />
      <TextField
        id={emailId}
        name="email"
        label={t.emailLabel}
        type="email"
        inputMode="email"
        autoComplete="username"
        placeholder={t.emailPlaceholder}
        value={email}
        onChange={setEmail}
        error={fieldErrors.email}
        inputRef={emailRef}
        required
      />
      <PasswordField
        id={passwordId}
        name="password"
        label={t.passwordLabel}
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        inputRef={passwordRef}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        required
      />
      <div className="flex justify-end">
        <LinkButton onClick={() => setView("forgot")}>{t.forgotPasswordLink}</LinkButton>
      </div>
      <SubmitButton pending={pending} submittingLabel={t.submitting}>
        {t.signInSubmit}
      </SubmitButton>
    </form>
  );
}

// Transient MFA challenge id — held in memory only (never persisted).
let sessionMfaAccountId: string | null = null;

// ---------------------------------------------------------------------------
// View: MFA / recovery code
// ---------------------------------------------------------------------------

function MfaView({
  t,
  onAuthed,
  setView,
  headingRef,
  mode,
}: ViewProps & { mode: "app" | "recovery" }) {
  const idBase = useId();
  const codeId = `${idBase}-code`;
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const accountId = sessionMfaAccountId;
  useEffect(() => {
    // A direct navigation to MFA without a challenge falls back to sign in.
    if (!accountId) setView("signin");
  }, [accountId, setView]);

  const isRecovery = mode === "recovery";
  const summaryErrors: SummaryError[] = fieldError
    ? [{ id: codeId, message: fieldError }]
    : [];

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setServerError(null);
        const trimmed = code.trim();
        let err: string | undefined;
        if (!trimmed) err = t.codeRequired;
        else if (!isRecovery && !/^\d{6}$/.test(trimmed)) err = t.codeFormat;
        setFieldError(err);
        if (err) {
          codeRef.current?.focus();
          return;
        }
        if (!accountId) {
          setView("signin");
          return;
        }
        setPending(true);
        try {
          const result = isRecovery
            ? await submitMfaRecovery(accountId, trimmed)
            : await submitMfaChallenge(accountId, trimmed);
          if (result.status === "authenticated") {
            sessionMfaAccountId = null;
            onAuthed(result.staff);
          } else {
            sessionMfaAccountId = result.accountId;
          }
        } catch (err2) {
          setServerError(
            err2 instanceof AuthError && err2.code === "invalid_code"
              ? isRecovery
                ? t.recoveryInvalidCode
                : t.mfaInvalidCode
              : messageForError(err2, t),
          );
          requestAnimationFrame(() => summaryRef.current?.focus());
        } finally {
          setPending(false);
        }
      }}
    >
      <ViewHeader
        headingRef={headingRef}
        title={isRecovery ? t.recoveryTitle : t.mfaTitle}
        subtitle={isRecovery ? t.recoverySubtitle : t.mfaSubtitle}
      />
      <ErrorSummary title={t.errorSummaryTitle} errors={summaryErrors} summaryRef={summaryRef} />
      <ServerErrorBanner message={serverError} />
      <TextField
        id={codeId}
        name="code"
        label={isRecovery ? t.recoveryCodeLabel : t.codeLabel}
        inputMode={isRecovery ? "text" : "numeric"}
        autoComplete="one-time-code"
        value={code}
        onChange={setCode}
        error={fieldError}
        inputRef={codeRef}
        required
      />
      <SubmitButton pending={pending} submittingLabel={t.submitting}>
        {isRecovery ? t.recoverySubmit : t.mfaSubmit}
      </SubmitButton>
      <div className="flex items-center justify-between">
        <LinkButton onClick={() => setView(isRecovery ? "mfa" : "recovery")}>
          {isRecovery ? t.recoveryUseApp : t.mfaUseRecovery}
        </LinkButton>
        <LinkButton
          onClick={() => {
            sessionMfaAccountId = null;
            setView("signin");
          }}
        >
          {t.back}
        </LinkButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// View: Forgot password
// ---------------------------------------------------------------------------

function ForgotView({ t, setView, headingRef }: ViewProps) {
  const idBase = useId();
  const emailId = `${idBase}-email`;
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const summaryErrors: SummaryError[] = fieldError
    ? [{ id: emailId, message: fieldError }]
    : [];

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setServerError(null);
        const trimmed = email.trim();
        let err: string | undefined;
        if (!trimmed) err = t.emailRequired;
        else if (!EMAIL_RE.test(trimmed)) err = t.emailInvalid;
        setFieldError(err);
        if (err) {
          emailRef.current?.focus();
          return;
        }
        setPending(true);
        try {
          await forgotPassword(trimmed);
          // Always show the same generic confirmation (no account enumeration).
          setView("forgot_sent");
        } catch (err2) {
          // Network/5xx: still avoid leaking existence — show generic error.
          setServerError(messageForError(err2, t));
          requestAnimationFrame(() => summaryRef.current?.focus());
        } finally {
          setPending(false);
        }
      }}
    >
      <ViewHeader headingRef={headingRef} title={t.forgotTitle} subtitle={t.forgotSubtitle} />
      <ErrorSummary title={t.errorSummaryTitle} errors={summaryErrors} summaryRef={summaryRef} />
      <ServerErrorBanner message={serverError} />
      <TextField
        id={emailId}
        name="email"
        label={t.emailLabel}
        type="email"
        inputMode="email"
        autoComplete="username"
        placeholder={t.emailPlaceholder}
        value={email}
        onChange={setEmail}
        error={fieldError}
        inputRef={emailRef}
        required
      />
      <SubmitButton pending={pending} submittingLabel={t.submitting}>
        {t.forgotSubmit}
      </SubmitButton>
      <div className="flex justify-center">
        <LinkButton onClick={() => setView("signin")}>{t.forgotBackToSignIn}</LinkButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shared new-password validation
// ---------------------------------------------------------------------------

function validateNewPassword(
  password: string,
  confirm: string,
  t: AuthStrings,
): { password?: string; confirm?: string } {
  const errs: { password?: string; confirm?: string } = {};
  if (!password) errs.password = t.passwordRequired;
  else if (password.length < MIN_PASSWORD) errs.password = t.passwordTooShort;
  if (confirm !== password) errs.confirm = t.passwordsDoNotMatch;
  return errs;
}

function tokenErrorView(err: unknown): View | null {
  if (err instanceof AuthError) {
    if (err.code === "token_expired") return "reset_error";
    if (err.code === "token_used") return "reset_error";
    if (err.code === "token_invalid") return "reset_error";
  }
  return null;
}

// ---------------------------------------------------------------------------
// View: Reset password
// ---------------------------------------------------------------------------

function ResetView({ t, setView, headingRef, token }: ViewProps) {
  const idBase = useId();
  const pwId = `${idBase}-password`;
  const confirmId = `${idBase}-confirm`;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [resetErrorBody, setResetErrorBody] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const summaryErrors: SummaryError[] = [];
  if (fieldErrors.password) summaryErrors.push({ id: pwId, message: fieldErrors.password });
  if (fieldErrors.confirm) summaryErrors.push({ id: confirmId, message: fieldErrors.confirm });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setServerError(null);
        const errs = validateNewPassword(password, confirm, t);
        setFieldErrors(errs);
        if (errs.password) {
          pwRef.current?.focus();
          return;
        }
        if (errs.confirm) {
          confirmRef.current?.focus();
          return;
        }
        if (!token) {
          setView("reset_error");
          return;
        }
        setPending(true);
        try {
          await resetPassword(token, password);
          setView("reset_done");
        } catch (err) {
          const tokenView = tokenErrorView(err);
          if (tokenView) {
            if (err instanceof AuthError && err.code === "token_expired") {
              setResetErrorBody(t.resetExpiredBody);
            } else if (err instanceof AuthError && err.code === "token_used") {
              setResetErrorBody(t.resetUsedBody);
            } else {
              setResetErrorBody(t.resetInvalidBody);
            }
            setView("reset_error");
          } else {
            setServerError(messageForError(err, t));
            requestAnimationFrame(() => summaryRef.current?.focus());
          }
        } finally {
          setPending(false);
        }
      }}
    >
      <ViewHeader headingRef={headingRef} title={t.resetTitle} subtitle={t.resetSubtitle} />
      <ErrorSummary title={t.errorSummaryTitle} errors={summaryErrors} summaryRef={summaryRef} />
      <ServerErrorBanner message={serverError ?? resetErrorBody} />
      <PasswordField
        id={pwId}
        name="password"
        label={t.newPasswordLabel}
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        inputRef={pwRef}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        required
      />
      <PasswordField
        id={confirmId}
        name="confirm"
        label={t.confirmPasswordLabel}
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
        error={fieldErrors.confirm}
        inputRef={confirmRef}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        required
      />
      <SubmitButton pending={pending} submittingLabel={t.submitting}>
        {t.resetSubmit}
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// View: Invitation acceptance
// ---------------------------------------------------------------------------

function InviteView({ t, setView, headingRef, token }: ViewProps) {
  const idBase = useId();
  const nameId = `${idBase}-name`;
  const pwId = `${idBase}-password`;
  const confirmId = `${idBase}-confirm`;
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const summaryErrors: SummaryError[] = [];
  if (fieldErrors.password) summaryErrors.push({ id: pwId, message: fieldErrors.password });
  if (fieldErrors.confirm) summaryErrors.push({ id: confirmId, message: fieldErrors.confirm });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setServerError(null);
        const errs = validateNewPassword(password, confirm, t);
        setFieldErrors(errs);
        if (errs.password) {
          pwRef.current?.focus();
          return;
        }
        if (errs.confirm) {
          confirmRef.current?.focus();
          return;
        }
        if (!token) {
          setView("invite_error");
          return;
        }
        setPending(true);
        try {
          await acceptInvite(token, password, name.trim() || undefined);
          setView("invite_done");
        } catch (err) {
          if (tokenErrorView(err)) {
            setView("invite_error");
          } else {
            setServerError(messageForError(err, t));
            requestAnimationFrame(() => summaryRef.current?.focus());
          }
        } finally {
          setPending(false);
        }
      }}
    >
      <ViewHeader headingRef={headingRef} title={t.inviteTitle} subtitle={t.inviteSubtitle} />
      <ErrorSummary title={t.errorSummaryTitle} errors={summaryErrors} summaryRef={summaryRef} />
      <ServerErrorBanner message={serverError} />
      <TextField
        id={nameId}
        name="name"
        label={t.nameOptional}
        autoComplete="name"
        value={name}
        onChange={setName}
      />
      <PasswordField
        id={pwId}
        name="password"
        label={t.newPasswordLabel}
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        inputRef={pwRef}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        required
      />
      <PasswordField
        id={confirmId}
        name="confirm"
        label={t.confirmPasswordLabel}
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
        error={fieldErrors.confirm}
        inputRef={confirmRef}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        required
      />
      <SubmitButton pending={pending} submittingLabel={t.submitting}>
        {t.inviteSubmit}
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// View: Bootstrap (initial owner setup)
// ---------------------------------------------------------------------------

function BootstrapView({ t, setView, headingRef, token }: ViewProps) {
  const idBase = useId();
  const nameId = `${idBase}-name`;
  const emailId = `${idBase}-email`;
  const pwId = `${idBase}-password`;
  const confirmId = `${idBase}-confirm`;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const summaryErrors: SummaryError[] = [];
  if (fieldErrors.name) summaryErrors.push({ id: nameId, message: fieldErrors.name });
  if (fieldErrors.email) summaryErrors.push({ id: emailId, message: fieldErrors.email });
  if (fieldErrors.password) summaryErrors.push({ id: pwId, message: fieldErrors.password });
  if (fieldErrors.confirm) summaryErrors.push({ id: confirmId, message: fieldErrors.confirm });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setServerError(null);
        const errs: Record<string, string> = {};
        if (!name.trim()) errs.name = t.nameRequired;
        if (!email.trim()) errs.email = t.emailRequired;
        else if (!EMAIL_RE.test(email.trim())) errs.email = t.emailInvalid;
        const pwErrs = validateNewPassword(password, confirm, t);
        if (pwErrs.password) errs.password = pwErrs.password;
        if (pwErrs.confirm) errs.confirm = pwErrs.confirm;
        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) {
          if (errs.name) nameRef.current?.focus();
          else if (errs.email) emailRef.current?.focus();
          else if (errs.password) pwRef.current?.focus();
          else confirmRef.current?.focus();
          return;
        }
        if (!token) {
          setView("bootstrap_error");
          return;
        }
        setPending(true);
        try {
          await bootstrap(token, email.trim(), password, name.trim());
          setView("bootstrap_done");
        } catch (err) {
          if (tokenErrorView(err)) {
            setView("bootstrap_error");
          } else {
            setServerError(messageForError(err, t));
            requestAnimationFrame(() => summaryRef.current?.focus());
          }
        } finally {
          setPending(false);
        }
      }}
    >
      <ViewHeader headingRef={headingRef} title={t.bootstrapTitle} subtitle={t.bootstrapSubtitle} />
      <ErrorSummary title={t.errorSummaryTitle} errors={summaryErrors} summaryRef={summaryRef} />
      <ServerErrorBanner message={serverError} />
      <TextField
        id={nameId}
        name="name"
        label={t.nameLabel}
        autoComplete="name"
        value={name}
        onChange={setName}
        error={fieldErrors.name}
        inputRef={nameRef}
        required
      />
      <TextField
        id={emailId}
        name="email"
        label={t.emailLabel}
        type="email"
        inputMode="email"
        autoComplete="username"
        placeholder={t.emailPlaceholder}
        value={email}
        onChange={setEmail}
        error={fieldErrors.email}
        inputRef={emailRef}
        required
      />
      <PasswordField
        id={pwId}
        name="password"
        label={t.newPasswordLabel}
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        inputRef={pwRef}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        required
      />
      <PasswordField
        id={confirmId}
        name="confirm"
        label={t.confirmPasswordLabel}
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
        error={fieldErrors.confirm}
        inputRef={confirmRef}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        required
      />
      <SubmitButton pending={pending} submittingLabel={t.submitting}>
        {t.bootstrapSubmit}
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Panels: info / token error
// ---------------------------------------------------------------------------

function InfoPanel({
  headingRef,
  title,
  body,
  actionLabel,
  onAction,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="space-y-4">
      <ViewHeader headingRef={headingRef} title={title} />
      <p className="text-sm text-ink" role="status">
        {body}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="w-full rounded-lg bg-lime px-3 py-2.5 font-semibold text-obsidian transition hover:bg-lime/90 focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-2 focus:ring-offset-obsidian"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function TokenErrorPanel({
  headingRef,
  title,
  body,
  actionLabel,
  onAction,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="space-y-4">
      <ViewHeader headingRef={headingRef} title={title} />
      <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
        {body}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="w-full rounded-lg bg-lime px-3 py-2.5 font-semibold text-obsidian transition hover:bg-lime/90 focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-2 focus:ring-offset-obsidian"
      >
        {actionLabel}
      </button>
    </div>
  );
}

// Re-exported so callers can prewarm the session without importing authApi.
export { fetchSession };
