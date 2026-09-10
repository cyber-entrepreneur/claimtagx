import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  HandlerAuthError,
  login,
  submitMfaChallenge,
  submitMfaRecovery,
} from "@/lib/authApi";

type View = "signin" | "mfa" | "recovery";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COPY = {
  brand: "ClaimTagX",
  workspace: "Handler",
  signInTitle: "Handler sign-in",
  signInSubtitle: "Sign in to open a custody shift.",
  emailLabel: "Work email",
  emailPlaceholder: "you@company.com",
  passwordLabel: "Password",
  showPassword: "Show",
  hidePassword: "Hide",
  signInSubmit: "Sign in",
  submitting: "Please wait…",
  errorSummaryTitle: "Please fix the following:",
  emailRequired: "Enter your work email.",
  emailInvalid: "Enter a valid email address.",
  passwordRequired: "Enter your password.",
  codeRequired: "Enter your authentication code.",
  codeFormat: "Enter the 6-digit code.",
  invalidCredentials: "The email or password is incorrect.",
  throttled: "Too many attempts. Please wait a moment and try again.",
  locked: "Access is temporarily locked. Try again later or contact an owner.",
  suspended: "This account is not active. Contact a venue owner.",
  networkError: "We couldn't reach the server. Check your connection and retry.",
  genericError: "Something went wrong. Please try again.",
  mfaTitle: "Two-step verification",
  mfaSubtitle: "Enter the code from your authenticator app.",
  mfaSubmit: "Verify",
  codeLabel: "Authentication code",
  recoveryCodeLabel: "Recovery code",
  mfaUseRecovery: "Use a recovery code instead",
  recoveryUseApp: "Use your authenticator app instead",
  recoveryTitle: "Use a recovery code",
  recoverySubtitle: "Enter one of your saved recovery codes.",
  mfaInvalidCode: "That code isn't valid. Please try again.",
  back: "Back",
  sessionExpired: "Your session expired. Please sign in again.",
};

function messageForError(err: unknown): string {
  if (err instanceof HandlerAuthError) {
    switch (err.code) {
      case "invalid_credentials":
        return COPY.invalidCredentials;
      case "throttled":
        return COPY.throttled;
      case "locked":
        return COPY.locked;
      case "suspended":
        return COPY.suspended;
      case "invalid_code":
        return COPY.mfaInvalidCode;
      case "network":
        return COPY.networkError;
      default:
        return COPY.genericError;
    }
  }
  return COPY.genericError;
}

const inputClass =
  "w-full rounded-xl bg-obsidian/60 border border-white/10 px-3 py-2.5 text-white placeholder:text-slate " +
  "focus:outline-none focus:ring-2 focus:ring-lime focus:border-lime focus:ring-offset-2 focus:ring-offset-obsidian " +
  "aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-400/40";

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-obsidian text-paper font-sans bg-gradient-mesh flex items-center justify-center px-4 py-12">
      <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />
      <div className="relative w-full max-w-md">
        <div className="rounded-3xl border border-white/10 bg-steel/40 backdrop-blur-md shadow-2xl p-6 md:p-8 space-y-6">
          <div>
            <p className="text-lg font-extrabold">
              Claim<span className="text-lime">TagX</span>
            </p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate">
              {COPY.workspace}
            </p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-300">
      {message}
    </p>
  );
}

function ErrorSummary({
  errors,
  summaryRef,
}: {
  errors: { id: string; message: string }[];
  summaryRef: React.Ref<HTMLDivElement>;
}) {
  if (errors.length === 0) return null;
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
    >
      <p className="text-sm font-medium text-red-200">{COPY.errorSummaryTitle}</p>
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

function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {message}
    </p>
  );
}

let mfaAccountId: string | null = null;

export default function HandlerLogin() {
  const { refreshMe } = useStore();
  const [view, setView] = useState<View>("signin");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [reason] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("reason") === "session_expired"
      ? COPY.sessionExpired
      : null;
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, [view]);

  if (view === "signin") {
    return (
      <AuthShell>
        {reason ? (
          <p className="rounded-xl border border-lime/30 bg-lime/10 px-3 py-2 text-sm text-lime" role="status">
            {reason}
          </p>
        ) : null}
        <SignInForm
          headingRef={headingRef}
          onMfa={(id) => {
            mfaAccountId = id;
            setView("mfa");
          }}
          onAuthed={() => void refreshMe()}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <MfaForm
        headingRef={headingRef}
        mode={view === "recovery" ? "recovery" : "app"}
        onAuthed={() => {
          mfaAccountId = null;
          void refreshMe();
        }}
        onSwitch={(next) => setView(next)}
      />
    </AuthShell>
  );
}

function SignInForm({
  headingRef,
  onMfa,
  onAuthed,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onMfa: (accountId: string) => void;
  onAuthed: () => void;
}) {
  const idBase = useId();
  const emailId = `${idBase}-email`;
  const passwordId = `${idBase}-password`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const summaryErrors: { id: string; message: string }[] = [];
  if (fieldErrors.email) summaryErrors.push({ id: emailId, message: fieldErrors.email });
  if (fieldErrors.password) summaryErrors.push({ id: passwordId, message: fieldErrors.password });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setServerError(null);
        const errs: Record<string, string> = {};
        if (!email.trim()) errs.email = COPY.emailRequired;
        else if (!EMAIL_RE.test(email.trim())) errs.email = COPY.emailInvalid;
        if (!password) errs.password = COPY.passwordRequired;
        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) {
          if (errs.email) emailRef.current?.focus();
          else passwordRef.current?.focus();
          return;
        }
        setPending(true);
        try {
          const result = await login(email.trim(), password);
          if (result.status === "mfa_required") onMfa(result.accountId);
          else onAuthed();
        } catch (err) {
          setServerError(messageForError(err));
          requestAnimationFrame(() => summaryRef.current?.focus());
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
          {COPY.signInTitle}
        </h1>
        <p className="mt-1 text-sm text-slate">{COPY.signInSubtitle}</p>
      </div>
      <ErrorSummary errors={summaryErrors} summaryRef={summaryRef} />
      <ServerError message={serverError} />
      <div>
        <label className="block text-xs font-medium text-slate mb-1" htmlFor={emailId}>
          {COPY.emailLabel}
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder={COPY.emailPlaceholder}
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          ref={emailRef}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
          required
        />
        <FieldError id={`${emailId}-error`} message={fieldErrors.email} />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate mb-1" htmlFor={passwordId}>
          {COPY.passwordLabel}
        </label>
        <div className="relative">
          <input
            id={passwordId}
            name="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            className={`${inputClass} pe-14`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            ref={passwordRef}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? `${passwordId}-error` : undefined}
            required
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-pressed={showPw}
            className="absolute inset-y-0 end-0 px-3 text-xs text-slate hover:text-paper focus:outline-none focus:ring-2 focus:ring-lime rounded-e-xl"
          >
            {showPw ? COPY.hidePassword : COPY.showPassword}
          </button>
        </div>
        <FieldError id={`${passwordId}-error`} message={fieldErrors.password} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-lime px-3 py-2.5 font-bold text-obsidian transition hover:bg-lime-hover disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-2 focus:ring-offset-obsidian"
      >
        {pending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> {COPY.submitting}
          </>
        ) : (
          COPY.signInSubmit
        )}
      </button>
    </form>
  );
}

function MfaForm({
  headingRef,
  mode,
  onAuthed,
  onSwitch,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  mode: "app" | "recovery";
  onAuthed: () => void;
  onSwitch: (next: View) => void;
}) {
  const idBase = useId();
  const codeId = `${idBase}-code`;
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const isRecovery = mode === "recovery";

  useEffect(() => {
    if (!mfaAccountId) onSwitch("signin");
  }, [onSwitch]);

  const summaryErrors = fieldError ? [{ id: codeId, message: fieldError }] : [];

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setServerError(null);
        const trimmed = code.trim();
        let err: string | undefined;
        if (!trimmed) err = COPY.codeRequired;
        else if (!isRecovery && !/^\d{6}$/.test(trimmed)) err = COPY.codeFormat;
        setFieldError(err);
        if (err) {
          codeRef.current?.focus();
          return;
        }
        if (!mfaAccountId) {
          onSwitch("signin");
          return;
        }
        setPending(true);
        try {
          const result = isRecovery
            ? await submitMfaRecovery(mfaAccountId, trimmed)
            : await submitMfaChallenge(mfaAccountId, trimmed);
          if (result.status === "authenticated") onAuthed();
          else mfaAccountId = result.accountId;
        } catch (err2) {
          setServerError(messageForError(err2));
          requestAnimationFrame(() => summaryRef.current?.focus());
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
          {isRecovery ? COPY.recoveryTitle : COPY.mfaTitle}
        </h1>
        <p className="mt-1 text-sm text-slate">
          {isRecovery ? COPY.recoverySubtitle : COPY.mfaSubtitle}
        </p>
      </div>
      <ErrorSummary errors={summaryErrors} summaryRef={summaryRef} />
      <ServerError message={serverError} />
      <div>
        <label className="block text-xs font-medium text-slate mb-1" htmlFor={codeId}>
          {isRecovery ? COPY.recoveryCodeLabel : COPY.codeLabel}
        </label>
        <input
          id={codeId}
          name="code"
          inputMode={isRecovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          className={inputClass}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          ref={codeRef}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${codeId}-error` : undefined}
          required
        />
        <FieldError id={`${codeId}-error`} message={fieldError} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-lime px-3 py-2.5 font-bold text-obsidian transition hover:bg-lime-hover disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-2 focus:ring-offset-obsidian"
      >
        {pending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> {COPY.submitting}
          </>
        ) : (
          COPY.mfaSubmit
        )}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => onSwitch(isRecovery ? "mfa" : "recovery")}
          className="text-lime underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-lime rounded"
        >
          {isRecovery ? COPY.recoveryUseApp : COPY.mfaUseRecovery}
        </button>
        <button
          type="button"
          onClick={() => {
            mfaAccountId = null;
            onSwitch("signin");
          }}
          className="text-slate hover:text-paper focus:outline-none focus:ring-2 focus:ring-lime rounded"
        >
          {COPY.back}
        </button>
      </div>
    </form>
  );
}
