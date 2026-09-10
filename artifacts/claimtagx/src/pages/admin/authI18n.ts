// Dedicated i18n dictionary for the first-party admin authentication screens.
//
// The public marketing site drives locale from the URL prefix (`/ar/...`),
// but Contact Ops lives under `/admin` with no locale prefix. Auth screens
// therefore ship their own self-contained en/ar dictionary plus a lightweight
// language toggle so an operator can switch language (and RTL) on the sign-in
// surface without touching the site-wide router. No account-enumerating copy
// is used anywhere in these strings.

export type AuthLang = "en" | "ar";

export const AUTH_LANG_META: Record<
  AuthLang,
  { label: string; nativeLabel: string; dir: "ltr" | "rtl"; hrefLang: string }
> = {
  en: { label: "English", nativeLabel: "English", dir: "ltr", hrefLang: "en" },
  ar: { label: "Arabic", nativeLabel: "العربية", dir: "rtl", hrefLang: "ar" },
};

export interface AuthStrings {
  // Chrome / shared
  brand: string;
  workspace: string;
  languageToggleLabel: string;
  switchToArabic: string;
  switchToEnglish: string;
  back: string;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  newPasswordLabel: string;
  confirmPasswordLabel: string;
  nameLabel: string;
  nameOptional: string;
  codeLabel: string;
  recoveryCodeLabel: string;
  showPassword: string;
  hidePassword: string;
  submitting: string;
  errorSummaryTitle: string;

  // Sign in
  signInTitle: string;
  signInSubtitle: string;
  signInSubmit: string;
  forgotPasswordLink: string;

  // Validation
  emailRequired: string;
  emailInvalid: string;
  passwordRequired: string;
  codeRequired: string;
  codeFormat: string;
  passwordTooShort: string;
  passwordsDoNotMatch: string;
  nameRequired: string;

  // Generic / error states (non-enumerating)
  invalidCredentials: string;
  throttled: string;
  locked: string;
  suspended: string;
  sessionExpired: string;
  networkError: string;
  genericError: string;

  // MFA
  mfaTitle: string;
  mfaSubtitle: string;
  mfaSubmit: string;
  mfaUseRecovery: string;
  mfaInvalidCode: string;

  // Recovery code
  recoveryTitle: string;
  recoverySubtitle: string;
  recoverySubmit: string;
  recoveryUseApp: string;
  recoveryInvalidCode: string;

  // Forgot password
  forgotTitle: string;
  forgotSubtitle: string;
  forgotSubmit: string;
  forgotBackToSignIn: string;
  forgotSentTitle: string;
  forgotSentBody: string;

  // Reset password
  resetTitle: string;
  resetSubtitle: string;
  resetSubmit: string;
  resetSuccessTitle: string;
  resetSuccessBody: string;
  resetInvalidTitle: string;
  resetInvalidBody: string;
  resetExpiredBody: string;
  resetUsedBody: string;
  resetRequestNew: string;
  goToSignIn: string;

  // Invitation acceptance
  inviteTitle: string;
  inviteSubtitle: string;
  inviteSubmit: string;
  inviteInvalidTitle: string;
  inviteInvalidBody: string;
  inviteSuccessTitle: string;
  inviteSuccessBody: string;

  // Bootstrap (initial owner setup)
  bootstrapTitle: string;
  bootstrapSubtitle: string;
  bootstrapSubmit: string;
  bootstrapInvalidTitle: string;
  bootstrapInvalidBody: string;

  // Logout confirmations
  signedOutTitle: string;
  signedOutBody: string;
  loggedOutEverywhereTitle: string;
  loggedOutEverywhereBody: string;
}

const en: AuthStrings = {
  brand: "ClaimTagX",
  workspace: "Contact Ops",
  languageToggleLabel: "Language",
  switchToArabic: "العربية",
  switchToEnglish: "English",
  back: "Back",
  emailLabel: "Work email",
  emailPlaceholder: "you@company.com",
  passwordLabel: "Password",
  newPasswordLabel: "New password",
  confirmPasswordLabel: "Confirm password",
  nameLabel: "Full name",
  nameOptional: "Full name (optional)",
  codeLabel: "Authentication code",
  recoveryCodeLabel: "Recovery code",
  showPassword: "Show password",
  hidePassword: "Hide password",
  submitting: "Please wait…",
  errorSummaryTitle: "Please fix the following:",

  signInTitle: "Sign in",
  signInSubtitle: "Access the ClaimTagX Contact Ops workspace.",
  signInSubmit: "Sign in",
  forgotPasswordLink: "Forgot your password?",

  emailRequired: "Enter your work email.",
  emailInvalid: "Enter a valid email address.",
  passwordRequired: "Enter your password.",
  codeRequired: "Enter your authentication code.",
  codeFormat: "Enter the 6-digit code.",
  passwordTooShort: "Use at least 12 characters.",
  passwordsDoNotMatch: "The passwords do not match.",
  nameRequired: "Enter your name.",

  invalidCredentials: "The email or password is incorrect.",
  throttled: "Too many attempts. Please wait a moment and try again.",
  locked: "Access is temporarily locked. Try again later or contact an owner.",
  suspended: "This account is not active. Contact a workspace owner.",
  sessionExpired: "Your session expired. Please sign in again.",
  networkError: "We couldn't reach the server. Check your connection and retry.",
  genericError: "Something went wrong. Please try again.",

  mfaTitle: "Two-step verification",
  mfaSubtitle: "Enter the code from your authenticator app.",
  mfaSubmit: "Verify",
  mfaUseRecovery: "Use a recovery code instead",
  mfaInvalidCode: "That code isn't valid. Please try again.",

  recoveryTitle: "Use a recovery code",
  recoverySubtitle: "Enter one of your saved recovery codes.",
  recoverySubmit: "Verify",
  recoveryUseApp: "Use your authenticator app instead",
  recoveryInvalidCode: "That recovery code isn't valid. Please try again.",

  forgotTitle: "Reset your password",
  forgotSubtitle: "Enter your work email and we'll send reset instructions.",
  forgotSubmit: "Send reset instructions",
  forgotBackToSignIn: "Back to sign in",
  forgotSentTitle: "Check your email",
  forgotSentBody:
    "If an account matches that email, we've sent password reset instructions. The link expires soon.",

  resetTitle: "Choose a new password",
  resetSubtitle: "Set a new password for your account.",
  resetSubmit: "Update password",
  resetSuccessTitle: "Password updated",
  resetSuccessBody: "Your password has been updated. You can now sign in.",
  resetInvalidTitle: "Reset link problem",
  resetInvalidBody: "This password reset link isn't valid.",
  resetExpiredBody: "This password reset link has expired.",
  resetUsedBody: "This password reset link has already been used.",
  resetRequestNew: "Request a new link",
  goToSignIn: "Go to sign in",

  inviteTitle: "Accept your invitation",
  inviteSubtitle: "Set a password to activate your Contact Ops access.",
  inviteSubmit: "Activate account",
  inviteInvalidTitle: "Invitation problem",
  inviteInvalidBody: "This invitation link isn't valid or has expired.",
  inviteSuccessTitle: "You're all set",
  inviteSuccessBody: "Your account is active. You can now sign in.",

  bootstrapTitle: "Set up the first owner",
  bootstrapSubtitle: "Create the initial workspace owner account.",
  bootstrapSubmit: "Create owner account",
  bootstrapInvalidTitle: "Setup link problem",
  bootstrapInvalidBody: "This setup link isn't valid or has expired.",

  signedOutTitle: "Signed out",
  signedOutBody: "You've been signed out of this device.",
  loggedOutEverywhereTitle: "Signed out everywhere",
  loggedOutEverywhereBody: "All of your sessions have been signed out.",
};

const ar: AuthStrings = {
  brand: "ClaimTagX",
  workspace: "عمليات التواصل",
  languageToggleLabel: "اللغة",
  switchToArabic: "العربية",
  switchToEnglish: "English",
  back: "رجوع",
  emailLabel: "البريد الإلكتروني للعمل",
  emailPlaceholder: "you@company.com",
  passwordLabel: "كلمة المرور",
  newPasswordLabel: "كلمة مرور جديدة",
  confirmPasswordLabel: "تأكيد كلمة المرور",
  nameLabel: "الاسم الكامل",
  nameOptional: "الاسم الكامل (اختياري)",
  codeLabel: "رمز المصادقة",
  recoveryCodeLabel: "رمز الاسترداد",
  showPassword: "إظهار كلمة المرور",
  hidePassword: "إخفاء كلمة المرور",
  submitting: "يرجى الانتظار…",
  errorSummaryTitle: "يرجى تصحيح ما يلي:",

  signInTitle: "تسجيل الدخول",
  signInSubtitle: "الوصول إلى مساحة عمل عمليات التواصل في ClaimTagX.",
  signInSubmit: "تسجيل الدخول",
  forgotPasswordLink: "هل نسيت كلمة المرور؟",

  emailRequired: "أدخل بريدك الإلكتروني للعمل.",
  emailInvalid: "أدخل عنوان بريد إلكتروني صالحًا.",
  passwordRequired: "أدخل كلمة المرور.",
  codeRequired: "أدخل رمز المصادقة.",
  codeFormat: "أدخل الرمز المكوّن من 6 أرقام.",
  passwordTooShort: "استخدم 12 حرفًا على الأقل.",
  passwordsDoNotMatch: "كلمتا المرور غير متطابقتين.",
  nameRequired: "أدخل اسمك.",

  invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  throttled: "محاولات كثيرة جدًا. يرجى الانتظار قليلاً والمحاولة مرة أخرى.",
  locked: "الوصول مقفل مؤقتًا. حاول لاحقًا أو تواصل مع أحد المالكين.",
  suspended: "هذا الحساب غير نشط. تواصل مع أحد مالكي مساحة العمل.",
  sessionExpired: "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.",
  networkError: "تعذّر الوصول إلى الخادم. تحقق من اتصالك وحاول مرة أخرى.",
  genericError: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",

  mfaTitle: "التحقق بخطوتين",
  mfaSubtitle: "أدخل الرمز من تطبيق المصادقة الخاص بك.",
  mfaSubmit: "تحقق",
  mfaUseRecovery: "استخدم رمز استرداد بدلاً من ذلك",
  mfaInvalidCode: "هذا الرمز غير صالح. يرجى المحاولة مرة أخرى.",

  recoveryTitle: "استخدام رمز استرداد",
  recoverySubtitle: "أدخل أحد رموز الاسترداد المحفوظة لديك.",
  recoverySubmit: "تحقق",
  recoveryUseApp: "استخدم تطبيق المصادقة بدلاً من ذلك",
  recoveryInvalidCode: "رمز الاسترداد غير صالح. يرجى المحاولة مرة أخرى.",

  forgotTitle: "إعادة تعيين كلمة المرور",
  forgotSubtitle: "أدخل بريدك الإلكتروني وسنرسل تعليمات إعادة التعيين.",
  forgotSubmit: "إرسال تعليمات إعادة التعيين",
  forgotBackToSignIn: "العودة إلى تسجيل الدخول",
  forgotSentTitle: "تحقق من بريدك الإلكتروني",
  forgotSentBody:
    "إذا كان هناك حساب مطابق لهذا البريد، فقد أرسلنا تعليمات إعادة تعيين كلمة المرور. تنتهي صلاحية الرابط قريبًا.",

  resetTitle: "اختر كلمة مرور جديدة",
  resetSubtitle: "قم بتعيين كلمة مرور جديدة لحسابك.",
  resetSubmit: "تحديث كلمة المرور",
  resetSuccessTitle: "تم تحديث كلمة المرور",
  resetSuccessBody: "تم تحديث كلمة المرور. يمكنك الآن تسجيل الدخول.",
  resetInvalidTitle: "مشكلة في رابط إعادة التعيين",
  resetInvalidBody: "رابط إعادة تعيين كلمة المرور هذا غير صالح.",
  resetExpiredBody: "انتهت صلاحية رابط إعادة تعيين كلمة المرور هذا.",
  resetUsedBody: "تم استخدام رابط إعادة تعيين كلمة المرور هذا بالفعل.",
  resetRequestNew: "طلب رابط جديد",
  goToSignIn: "الذهاب إلى تسجيل الدخول",

  inviteTitle: "قبول دعوتك",
  inviteSubtitle: "قم بتعيين كلمة مرور لتفعيل وصولك إلى عمليات التواصل.",
  inviteSubmit: "تفعيل الحساب",
  inviteInvalidTitle: "مشكلة في الدعوة",
  inviteInvalidBody: "رابط الدعوة هذا غير صالح أو انتهت صلاحيته.",
  inviteSuccessTitle: "أصبح كل شيء جاهزًا",
  inviteSuccessBody: "حسابك نشط الآن. يمكنك تسجيل الدخول.",

  bootstrapTitle: "إعداد المالك الأول",
  bootstrapSubtitle: "أنشئ حساب مالك مساحة العمل الأولي.",
  bootstrapSubmit: "إنشاء حساب المالك",
  bootstrapInvalidTitle: "مشكلة في رابط الإعداد",
  bootstrapInvalidBody: "رابط الإعداد هذا غير صالح أو انتهت صلاحيته.",

  signedOutTitle: "تم تسجيل الخروج",
  signedOutBody: "تم تسجيل خروجك من هذا الجهاز.",
  loggedOutEverywhereTitle: "تم تسجيل الخروج من كل الأجهزة",
  loggedOutEverywhereBody: "تم تسجيل الخروج من جميع جلساتك.",
};

export const AUTH_DICTIONARIES: Record<AuthLang, AuthStrings> = { en, ar };

const AUTH_LANG_STORAGE_KEY = "claimtagx-admin-auth-lang";

/** Read a previously chosen auth language (falls back to English). */
export function readStoredAuthLang(): AuthLang {
  try {
    const stored = window.localStorage.getItem(AUTH_LANG_STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
    const nav = window.navigator?.language?.toLowerCase() ?? "";
    if (nav.startsWith("ar")) return "ar";
  } catch {
    // ignore storage/permission errors
  }
  return "en";
}

/** Persist the chosen auth language (best effort). */
export function storeAuthLang(lang: AuthLang): void {
  try {
    window.localStorage.setItem(AUTH_LANG_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}
