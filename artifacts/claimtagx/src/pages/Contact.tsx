import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js/max";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import SEO from "@/components/SEO";
import { isOptionalAnalyticsConsentGranted, track } from "@/lib/analytics";
import { fetchBootstrap, mapContactSubmitError, submitInquiry } from "@/lib/contactApi";
import { TurnstileField } from "@/lib/contactTurnstile";
import { isSafePublicBookingUrl } from "@/lib/bookingUrl";
import { useI18n } from "@/lib/i18n";
import { localizedAbsoluteUrl } from "@/lib/seo/siteConfig";
import { contactPageJsonLd } from "@/lib/seo/structuredData";
import {
  BILLING_QUESTIONS,
  buildCountryList,
  INQUIRY_TYPES,
  localeCountryGuess,
  MESSAGE_COPY,
  questionsFromTaxonomy,
  TECHNICAL_QUESTIONS,
  useCasesFromTaxonomy,
  type CatalogQuestion,
  type InquiryType,
} from "@/lib/contactCatalog";

const COUNTRIES = buildCountryList();

const ERROR_FOCUS: Record<string, string> = {
  inquiryType: '[name="inquiryType"]',
  firstName: "#firstName",
  lastName: "#lastName",
  jobTitle: "#jobTitle",
  companyName: "#companyName",
  email: "#email",
  country: "#country-search",
  phone: "#phone",
  useCase: "#use-case-group",
  useCaseOther: "#useCaseOther",
  message: "#message",
  consent: "#consent",
};

function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function attribution() {
  const params = new URLSearchParams(window.location.search);
  let stored: Record<string, string> = {};
  try {
    stored = JSON.parse(sessionStorage.getItem("claimtagx-attribution") || "{}") as Record<
      string,
      string
    >;
  } catch {
    stored = {};
  }
  return {
    landing_page: stored.landing_path || window.location.pathname,
    submission_page: window.location.pathname + window.location.search,
    referrer: document.referrer || stored.referrer || "",
    utm_source: params.get("utm_source") || stored.utm_source,
    utm_medium: params.get("utm_medium") || stored.utm_medium,
    utm_campaign: params.get("utm_campaign") || stored.utm_campaign,
    utm_term: params.get("utm_term") || stored.utm_term,
    utm_content: params.get("utm_content") || stored.utm_content,
    locale: navigator.language,
    device_category: window.innerWidth < 768 ? "mobile" : "desktop",
    country_detection_source: "ip",
  };
}

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-steel px-4 py-3 text-white placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-lime focus-visible:border-lime";

export default function Contact() {
  const { t, locale } = useI18n();
  const reduceMotion = useReducedMotion();
  const [countries] = useState(COUNTRIES);
  const [useCaseOptions, setUseCaseOptions] = useState(() => useCasesFromTaxonomy([]));
  const [salesQuestions, setSalesQuestions] = useState<CatalogQuestion[]>(() =>
    questionsFromTaxonomy([]),
  );
  const [inquiryType, setInquiryType] = useState<InquiryType | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [countryHighlight, setCountryHighlight] = useState(0);
  const [country, setCountry] = useState(() => localeCountryGuess() ?? "");
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [phoneNational, setPhoneNational] = useState("");
  const [useCases, setUseCases] = useState<string[]>([]);
  const [useCaseOther, setUseCaseOther] = useState("");
  const [answers, setAnswers] = useState<Record<string, { optionKeys: string[]; freeText?: string }>>(
    {},
  );
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    firstName: string;
    reference: string;
    qualified: boolean;
    meetingUrl: string | null;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [botSiteKey, setBotSiteKey] = useState("");
  const [botAction, setBotAction] = useState("contact_submit");
  const [botProofRequired, setBotProofRequired] = useState(false);
  const [botProof, setBotProof] = useState("");
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const started = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const countryBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOnline() {
      setOffline(false);
    }
    function onOffline() {
      setOffline(true);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    track("form_view", { form: "contact_us" });
    fetchBootstrap().then((data) => {
      if (!data) return;
      if (data.taxonomy?.length) {
        setUseCaseOptions(useCasesFromTaxonomy(data.taxonomy));
        setSalesQuestions(questionsFromTaxonomy(data.taxonomy));
      }
      if (data.detectedCountry) {
        setDetectedCountry(data.detectedCountry);
        setCountry(data.detectedCountry);
      }
      const bot = (data as { botProtection?: { siteKey?: string; action?: string; proofRequired?: boolean } })
        .botProtection;
      if (bot?.siteKey) setBotSiteKey(bot.siteKey);
      if (bot?.action) setBotAction(bot.action);
      setBotProofRequired(Boolean(bot?.proofRequired));
    });
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!countryBoxRef.current?.contains(e.target as Node)) setCountryOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selectedCountry = countries.find((c) => c.code === country);
  const callingCode = selectedCountry?.callingCode ?? "";

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.callingCode.includes(q.replace(/^\+/, "")),
    );
  }, [countries, countryQuery]);

  useEffect(() => {
    setCountryHighlight((i) => {
      if (!filteredCountries.length) return 0;
      return Math.min(i, filteredCountries.length - 1);
    });
  }, [filteredCountries]);

  function markStarted() {
    if (started.current) return;
    started.current = true;
    track("form_start", { form: "contact_us" });
  }

  function selectInquiryType(next: InquiryType) {
    setInquiryType(next);
    setUseCases([]);
    setUseCaseOther("");
    setAnswers({});
    setErrors({});
    markStarted();
    track("inquiry_type_selected", { inquiry_type: next });
  }

  function setAnswer(key: string, patch: { optionKeys?: string[]; freeText?: string }) {
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        optionKeys: patch.optionKeys ?? prev[key]?.optionKeys ?? [],
        freeText: patch.freeText ?? prev[key]?.freeText,
      },
    }));
  }

  function toggleMulti(question: string, key: string) {
    const current = answers[question]?.optionKeys ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    setAnswer(question, { optionKeys: next });
  }

  function formatNational(raw: string, iso: string) {
    if (!iso) return raw;
    const typer = new AsYouType(iso as never);
    return typer.input(raw);
  }

  function pickCountry(code: string) {
    setCountry(code);
    setCountryOpen(false);
    setCountryQuery("");
    setPhoneNational("");
    markStarted();
  }

  function focusField(key: string) {
    const selector = ERROR_FOCUS[key];
    const el = (selector ? formRef.current?.querySelector(selector) : null) as HTMLElement | null;
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }

  function validate(form: FormData): Record<string, string> {
    const next: Record<string, string> = {};
    if (!inquiryType) next.inquiryType = t("contact.errors.inquiryType");
    const firstName = String(form.get("firstName") ?? "").trim();
    const lastName = String(form.get("lastName") ?? "").trim();
    const jobTitle = String(form.get("jobTitle") ?? "").trim();
    const companyName = String(form.get("companyName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    if (!firstName) next.firstName = t("contact.errors.firstName");
    if (!lastName) next.lastName = t("contact.errors.lastName");
    if (!jobTitle) next.jobTitle = t("contact.errors.jobTitle");
    if (!companyName) next.companyName = t("contact.errors.companyName");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = t("contact.errors.email");
    if (!country) next.country = t("contact.errors.country");
    const parsed = country
      ? parsePhoneNumberFromString(`${callingCode} ${phoneNational}`, country as never)
      : undefined;
    if (!parsed?.isValid()) next.phone = t("contact.errors.phone");
    if (inquiryType === "sales") {
      if (useCases.length === 0) next.useCase = t("contact.errors.useCase");
      if (useCases.includes("other") && !useCaseOther.trim()) {
        next.useCaseOther = t("contact.errors.useCaseOther");
      }
    }
    if (inquiryType && message.length < 10) next.message = t("contact.errors.message");
    if (!consent) next.consent = t("contact.errors.consent");
    return next;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (offline) {
      setSubmitError(t("common.offline"));
      return;
    }
    const form = new FormData(e.currentTarget);
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      track("form_field_error", { fields: Object.keys(nextErrors) });
      const first = Object.keys(nextErrors)[0];
      requestAnimationFrame(() => focusField(first));
      return;
    }
    if (!inquiryType) return;
    if (botProofRequired && !botProof) {
      setSubmitError(t("contact.errors.securityCheck"));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    track("submission_attempted", { form: "contact_us", inquiry_type: inquiryType });
    try {
      const parsed = parsePhoneNumberFromString(
        `${callingCode} ${phoneNational}`,
        country as never,
      );
      const data = await submitInquiry({
        firstName: String(form.get("firstName")).trim(),
        lastName: String(form.get("lastName")).trim(),
        jobTitle: String(form.get("jobTitle")).trim(),
        companyName: String(form.get("companyName")).trim(),
        email: String(form.get("email")).trim(),
        country,
        phoneRaw: parsed?.number ?? `${callingCode}${phoneNational}`,
        inquiryType,
        useCaseKeys:
          inquiryType === "sales"
            ? useCases.includes("mixed")
              ? useCases
              : useCases.slice(0, 1).concat(useCases.filter((k) => k === "other"))
            : [],
        useCaseOther:
          inquiryType === "sales" && useCases.includes("other") ? useCaseOther.trim() : undefined,
        message: String(form.get("message")).trim(),
        answers: inquiryType === "general" || inquiryType === "other" ? {} : answers,
        termsAccepted: true,
        locale: navigator.language,
        attribution: {
          ...attribution(),
          inquiry_type: inquiryType,
          analyticsConsent: isOptionalAnalyticsConsentGranted(),
        },
        idempotencyKey: idempotencyKey.current,
        honeypot: String(form.get("companyWebsite") ?? ""),
        ...(botProof ? { botProof } : {}),
      });
      track("submission_succeeded", { qualified: data.qualified, inquiry_type: inquiryType });
      if (data.qualified) {
        track("contact_qualified", {});
        track("scheduling_cta_shown", {});
      }
      setResult({
        firstName: data.firstName,
        reference: data.reference,
        qualified: data.qualified,
        meetingUrl: data.meetingUrl,
      });
    } catch (err) {
      track("submission_failed", {});
      setSubmitError(mapContactSubmitError(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  const currentSolution = answers.current_solution?.optionKeys[0];
  const showCurrentFollowUp = currentSolution === "yes" || currentSolution === "partially";
  const messageCopy = inquiryType ? MESSAGE_COPY[inquiryType] : null;
  const sideQuestions =
    inquiryType === "technical"
      ? TECHNICAL_QUESTIONS
      : inquiryType === "billing"
        ? BILLING_QUESTIONS
        : [];
  const errorEntries = Object.entries(errors);
  const activeCountryOption = countryOpen ? filteredCountries[countryHighlight] : undefined;

  const contactUrl = localizedAbsoluteUrl("/contact", locale);

  return (
    <>
      <SEO
        title={t("contact.title")}
        description={t("contact.subtitle")}
        url={contactUrl}
        path="/contact"
        jsonLd={contactPageJsonLd({ url: contactUrl, locale })}
      />
      <section className="relative min-h-[calc(100svh-4.5rem)]">
        <div className="absolute inset-0 bg-gradient-mesh pointer-events-none" />
        <div className="absolute inset-0 bg-grid-pattern opacity-40 pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-36 md:pt-32 pb-20 grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-12 lg:gap-16 items-start">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.6 }}
            className="lg:sticky lg:top-28"
          >
            <p className="text-lime font-mono text-xs tracking-[0.2em] uppercase mb-4">{t("contact.eyebrow")}</p>
            <h1 className="text-4xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.05] mb-6">
              {t("contact.title")}
            </h1>
            <p className="text-lg text-ink max-w-md leading-relaxed">{t("contact.subtitle")}</p>
            <p className="text-sm text-ink mt-6">
              {t("contact.preferEmail")}{" "}
              <a
                href="mailto:info@claimtagx.com"
                className="text-lime underline underline-offset-2"
              >
                {t("contact.sendEmail")}
              </a>
            </p>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.7, delay: reduceMotion ? 0 : 0.08 }}
          >
            {result ? (
              <Confirmation result={result} />
            ) : (
              <form
                ref={formRef}
                onSubmit={onSubmit}
                onChange={markStarted}
                className="space-y-6"
                noValidate
                data-testid="contact-form"
              >
                {(offline || submitError) && (
                  <div
                    role="alert"
                    className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                    data-testid="contact-submit-alert"
                  >
                    <p className="text-sm text-amber-100">{offline ? t("common.offline") : submitError}</p>
                    {!offline && submitError && (
                      <button
                        type="button"
                        className="text-sm font-semibold text-lime underline underline-offset-2"
                        onClick={() => {
                          setSubmitError(null);
                          formRef.current?.requestSubmit();
                        }}
                      >
                        {t("common.retry")}
                      </button>
                    )}
                  </div>
                )}

                {errorEntries.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3"
                  >
                    <p className="text-sm font-medium text-white mb-2">
                      {errorEntries.length === 1 ? t("contact.fixIssues") : t("contact.fixIssuesPlural")}:
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      {errorEntries.map(([key, message]) => (
                        <li key={key}>
                          <button
                            type="button"
                            className="text-left text-sm text-red-200 underline underline-offset-2"
                            onClick={() => focusField(key)}
                          >
                            {message}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <fieldset>
                  <legend className="text-sm font-medium text-white mb-3">
                    {t("contact.helpWith")}{" "}
                    <span aria-hidden="true" className="text-lime">
                      *
                    </span>
                    <span className="sr-only">required</span>
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {INQUIRY_TYPES.map((opt) => {
                      const on = inquiryType === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          id={`inquiry-type-${opt.key}`}
                          name="inquiryType"
                          aria-pressed={on}
                          onClick={() => selectInquiryType(opt.key)}
                          data-testid={`inquiry-type-${opt.key}`}
                          className={`px-3 py-2 rounded-full text-sm border transition ${
                            on
                              ? "bg-lime text-obsidian border-lime"
                              : "border-white/10 text-ink hover:border-lime/40 hover:text-white"
                          }`}
                        >
                          {t(`contact.inquiryTypes.${opt.key}`)}
                        </button>
                      );
                    })}
                  </div>
                  {errors.inquiryType && (
                    <p id="inquiryType-error" className="text-red-300 text-sm mt-2">
                      {errors.inquiryType}
                    </p>
                  )}
                </fieldset>

                {inquiryType && (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field
                        label={t("contact.firstName")}
                        name="firstName"
                        error={errors.firstName}
                        required
                        autoComplete="given-name"
                      />
                      <Field
                        label={t("contact.lastName")}
                        name="lastName"
                        error={errors.lastName}
                        required
                        autoComplete="family-name"
                      />
                    </div>
                    <Field
                      label={t("contact.jobTitle")}
                      name="jobTitle"
                      error={errors.jobTitle}
                      required
                      autoComplete="organization-title"
                    />
                    <Field
                      label={t("contact.companyName")}
                      name="companyName"
                      error={errors.companyName}
                      required
                      autoComplete="organization"
                    />
                    <Field
                      label={t("contact.email")}
                      name="email"
                      type="email"
                      error={errors.email}
                      required
                      autoComplete="email"
                    />

                    <div>
                      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.15fr)_5.5rem_minmax(0,1.25fr)] gap-3 items-end">
                        <div ref={countryBoxRef} className="relative z-20">
                          <label
                            className="block text-sm font-medium text-white mb-2"
                            htmlFor="country-search"
                          >
                            {t("contact.country")}{" "}
                            <span aria-hidden="true" className="text-lime">
                              *
                            </span>
                            <span className="sr-only">{t("contact.required")}</span>
                          </label>
                          <div className="relative">
                            <input
                              id="country-search"
                              name="country"
                              autoComplete="country-name"
                              required
                              value={
                                countryOpen
                                  ? countryQuery
                                  : selectedCountry
                                    ? selectedCountry.name
                                    : countryQuery
                              }
                              placeholder={t("contact.searchCountry")}
                              onFocus={() => {
                                setCountryOpen(true);
                                setCountryQuery("");
                                const idx = filteredCountries.findIndex((c) => c.code === country);
                                setCountryHighlight(idx >= 0 ? idx : 0);
                              }}
                              onChange={(e) => {
                                setCountryOpen(true);
                                setCountryQuery(e.target.value);
                                setCountryHighlight(0);
                                markStarted();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  setCountryOpen(true);
                                  setCountryHighlight((i) =>
                                    Math.min(i + 1, Math.max(filteredCountries.length - 1, 0)),
                                  );
                                } else if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  setCountryOpen(true);
                                  setCountryHighlight((i) => Math.max(i - 1, 0));
                                } else if (e.key === "Enter" && countryOpen) {
                                  e.preventDefault();
                                  const picked = filteredCountries[countryHighlight];
                                  if (picked) pickCountry(picked.code);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  setCountryOpen(false);
                                }
                              }}
                              className={`${fieldClass} pr-10`}
                              aria-expanded={countryOpen}
                              aria-controls="country-list"
                              aria-autocomplete="list"
                              aria-activedescendant={
                                activeCountryOption ? `country-option-${activeCountryOption.code}` : undefined
                              }
                              aria-invalid={Boolean(errors.country)}
                              aria-describedby={
                                [errors.country ? "country-error" : "", "country-hint"]
                                  .filter(Boolean)
                                  .join(" ") || undefined
                              }
                              role="combobox"
                            />
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink" />
                          </div>
                          {countryOpen && (
                            <ul
                              id="country-list"
                              role="listbox"
                              className="absolute left-0 right-0 mt-2 z-50 max-h-64 overflow-auto rounded-xl border border-white/10 bg-[#0B1220] p-2 shadow-2xl"
                            >
                              {filteredCountries.length === 0 ? (
                                <li className="px-3 py-2 text-sm text-ink">{t("contact.errors.noMatchingCountry")}</li>
                              ) : (
                                filteredCountries.map((c, i) => (
                                  <li
                                    key={c.code}
                                    id={`country-option-${c.code}`}
                                    role="option"
                                    aria-selected={c.code === country || i === countryHighlight}
                                  >
                                    <button
                                      type="button"
                                      tabIndex={-1}
                                      className={`w-full text-left px-3 py-2 rounded-lg text-sm text-white ${
                                        i === countryHighlight ? "bg-white/10" : "hover:bg-white/5"
                                      }`}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onMouseEnter={() => setCountryHighlight(i)}
                                      onClick={() => pickCountry(c.code)}
                                    >
                                      {flagEmoji(c.code)} {c.name}
                                      <span className="text-ink ml-2">{c.callingCode}</span>
                                    </button>
                                  </li>
                                ))
                              )}
                            </ul>
                          )}
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-white mb-2" htmlFor="calling-code">
                            {t("contact.code")}
                          </label>
                          <input
                            id="calling-code"
                            readOnly
                            value={callingCode || "+"}
                            aria-label={t("contact.callingCode")}
                            className={`${fieldClass} font-mono text-center px-2`}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-white mb-2" htmlFor="phone">
                            {t("contact.phone")}{" "}
                            <span aria-hidden="true" className="text-lime">
                              *
                            </span>
                            <span className="sr-only">{t("contact.required")}</span>
                          </label>
                          <input
                            id="phone"
                            name="phone"
                            inputMode="tel"
                            autoComplete="tel-national"
                            required
                            placeholder={t("contact.phonePlaceholder")}
                            value={phoneNational}
                            onChange={(e) =>
                              setPhoneNational(formatNational(e.target.value, country))
                            }
                            aria-invalid={Boolean(errors.phone)}
                            aria-describedby={errors.phone ? "phone-error" : undefined}
                            className={fieldClass}
                          />
                        </div>
                      </div>
                      <p id="country-hint" className="text-xs text-ink mt-2">
                        {detectedCountry && country === detectedCountry
                          ? t("contact.countryDetectedHint")
                          : t("contact.countrySelectHint")}
                      </p>
                      {errors.country && (
                        <p id="country-error" className="text-red-300 text-sm mt-1">
                          {errors.country}
                        </p>
                      )}
                      {errors.phone && (
                        <p id="phone-error" className="text-red-300 text-sm mt-1">
                          {errors.phone}
                        </p>
                      )}
                    </div>

                    {inquiryType === "sales" && (
                      <fieldset>
                        <legend className="text-sm font-medium text-white mb-3">
                          {t("contact.useCaseLegend")}{" "}
                          <span aria-hidden="true" className="text-lime">
                            *
                          </span>
                          <span className="sr-only">{t("contact.required")}</span>
                        </legend>
                        <div id="use-case-group" className="flex flex-wrap gap-2" tabIndex={-1}>
                          {useCaseOptions.map((opt) => {
                            const on = useCases.includes(opt.key);
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                aria-pressed={on}
                                onClick={() => {
                                  markStarted();
                                  if (opt.key === "mixed") {
                                    setUseCases((prev) =>
                                      prev.includes("mixed")
                                        ? prev.filter((k) => k !== "mixed")
                                        : [...prev, "mixed"],
                                    );
                                    return;
                                  }
                                  setUseCases((prev) => {
                                    if (prev.includes("mixed")) {
                                      return prev.includes(opt.key)
                                        ? prev.filter((k) => k !== opt.key)
                                        : [...prev, opt.key];
                                    }
                                    return prev.includes(opt.key)
                                      ? prev.filter((k) => k !== opt.key)
                                      : [opt.key];
                                  });
                                }}
                                className={`px-3 py-2 rounded-full text-sm border transition ${
                                  on
                                    ? "bg-lime text-obsidian border-lime"
                                    : "border-white/10 text-ink hover:border-lime/40 hover:text-white"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        {useCases.includes("other") && (
                          <input
                            id="useCaseOther"
                            name="useCaseOther"
                            required
                            className={`${fieldClass} mt-3`}
                            placeholder={t("contact.useCaseOtherPlaceholder")}
                            value={useCaseOther}
                            onChange={(e) => setUseCaseOther(e.target.value)}
                            aria-invalid={Boolean(errors.useCaseOther)}
                            aria-describedby={errors.useCaseOther ? "useCaseOther-error" : undefined}
                          />
                        )}
                        {errors.useCase && (
                          <p id="useCase-error" className="text-red-300 text-sm mt-2">
                            {errors.useCase}
                          </p>
                        )}
                        {errors.useCaseOther && (
                          <p id="useCaseOther-error" className="text-red-300 text-sm mt-2">
                            {errors.useCaseOther}
                          </p>
                        )}
                      </fieldset>
                    )}

                    {messageCopy && (
                      <div>
                        <label className="block text-sm font-medium text-white mb-2" htmlFor="message">
                          {messageCopy.label}{" "}
                          <span aria-hidden="true" className="text-lime">
                            *
                          </span>
                          <span className="sr-only">required</span>
                        </label>
                        <textarea
                          id="message"
                          name="message"
                          rows={6}
                          maxLength={8000}
                          required
                          className={fieldClass}
                          placeholder={messageCopy.placeholder}
                          aria-invalid={Boolean(errors.message)}
                          aria-describedby={errors.message ? "message-error" : undefined}
                        />
                        {errors.message && (
                          <p id="message-error" className="text-red-300 text-sm mt-1">
                            {errors.message}
                          </p>
                        )}
                      </div>
                    )}

                    {inquiryType === "sales" && (
                      <div className="border-t border-white/10 pt-6 space-y-8">
                        <div>
                          <p className="text-white font-semibold">
                            {t("contact.salesHelpTitle")}
                          </p>
                          <p className="text-sm text-ink mt-1">
                            {t("contact.salesHelpSubtitle")}
                          </p>
                        </div>

                        {salesQuestions.map((q) => {
                          if (q.key === "improvements" && !showCurrentFollowUp) return null;
                          const selected = answers[q.key]?.optionKeys ?? [];
                          const multi = Boolean(q.multiple);
                          return (
                            <fieldset key={q.key}>
                              <legend className="text-sm font-medium text-white mb-3">
                                {q.label}
                              </legend>
                              <div className="flex flex-wrap gap-2">
                                {q.options.map((opt) => {
                                  const on = selected.includes(opt.key);
                                  return (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      aria-pressed={on}
                                      onClick={() =>
                                        multi
                                          ? toggleMulti(q.key, opt.key)
                                          : setAnswer(q.key, { optionKeys: [opt.key] })
                                      }
                                      className={`px-3 py-2 rounded-full text-sm border ${
                                        on
                                          ? "bg-white text-obsidian border-white"
                                          : "border-white/10 text-ink hover:text-white"
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                              {q.key === "current_solution" && showCurrentFollowUp && (
                                <input
                                  className={`${fieldClass} mt-4`}
                                  placeholder={t("contact.competitorPlaceholder")}
                                  value={answers.current_solution?.freeText ?? ""}
                                  onChange={(e) =>
                                    setAnswer("current_solution", { freeText: e.target.value })
                                  }
                                />
                              )}
                            </fieldset>
                          );
                        })}
                      </div>
                    )}

                    {sideQuestions.length > 0 && (
                      <div className="space-y-6">
                        {sideQuestions.map((q) => {
                          const selected = answers[q.key]?.optionKeys ?? [];
                          return (
                            <fieldset key={q.key}>
                              <legend className="text-sm font-medium text-white mb-3">
                                {q.label}
                              </legend>
                              <div className="flex flex-wrap gap-2">
                                {q.options.map((opt) => {
                                  const on = selected.includes(opt.key);
                                  return (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      aria-pressed={on}
                                      onClick={() => setAnswer(q.key, { optionKeys: [opt.key] })}
                                      className={`px-3 py-2 rounded-full text-sm border ${
                                        on
                                          ? "bg-white text-obsidian border-white"
                                          : "border-white/10 text-ink hover:text-white"
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </fieldset>
                          );
                        })}
                      </div>
                    )}

                    <label className="flex items-start gap-3 text-sm text-ink">
                      <input
                        id="consent"
                        name="consent"
                        type="checkbox"
                        required
                        className="mt-1 accent-[#C6F24E]"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                        aria-invalid={Boolean(errors.consent)}
                        aria-describedby={
                          [errors.consent ? "consent-error" : "", "consent-privacy"]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                      />
                      <span>
                        {t("contact.consentPrefix")}{" "}
                        <Link href="/terms" className="text-lime underline underline-offset-2">
                          {t("contact.terms")}
                        </Link>{" "}
                        {t("contact.consentMiddle")}{" "}
                        <Link href="/privacy" className="text-lime underline underline-offset-2">
                          {t("contact.privacy")}
                        </Link>
                        .{" "}
                        <span aria-hidden="true" className="text-lime">
                          *
                        </span>
                      </span>
                    </label>
                    <p id="consent-privacy" className="text-xs text-ink">
                      {t("contact.consentNote")}
                    </p>
                    {botSiteKey ? (
                      <TurnstileField siteKey={botSiteKey} action={botAction} onToken={setBotProof} />
                    ) : null}
                    {errors.consent && (
                      <p id="consent-error" className="text-red-300 text-sm">
                        {errors.consent}
                      </p>
                    )}

                    <div className="hidden" aria-hidden="true">
                      <input name="companyWebsite" tabIndex={-1} autoComplete="off" />
                    </div>


                    <p className="text-sm text-ink">{t("contact.responseTime")}</p>
                    <p className="text-sm text-ink">
                      {t("contact.orEmail")}{" "}
                      <a
                        href="mailto:info@claimtagx.com"
                        className="text-lime underline underline-offset-2"
                      >
                        {t("contact.sendEmail")}
                      </a>
                    </p>

                    <div aria-live="polite" className="sr-only">
                      {submitting ? t("common.submitting") : ""}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || offline}
                      data-testid="contact-submit"
                      className="w-full sm:w-auto bg-lime text-obsidian px-8 py-3.5 rounded-xl font-bold disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      {submitting && (
                        <Loader2 className={`w-4 h-4 ${reduceMotion ? "" : "animate-spin"}`} />
                      )}
                      {submitting ? t("common.submitting") : t("common.submit")}
                    </button>
                  </>
                )}
              </form>
            )}
          </motion.div>
        </div>
      </section>
    </>
  );
}

function Field({
  label,
  name,
  error,
  required,
  type = "text",
  autoComplete,
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <label className="block text-sm font-medium text-white mb-2" htmlFor={name}>
        {label}
        {required && (
          <>
            {" "}
            <span aria-hidden="true" className="text-lime">
              *
            </span>
            <span className="sr-only">required</span>
          </>
        )}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={fieldClass}
      />
      {error && (
        <p id={errorId} className="text-red-300 text-sm mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

function Confirmation({
  result,
}: {
  result: { firstName: string; reference: string; qualified: boolean; meetingUrl: string | null };
}) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summary = result.qualified
    ? t("contact.qualifiedBody")
    : t("contact.standardBody");
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <div
      className="rounded-[2rem] border border-white/10 bg-steel/30 p-8 md:p-12"
      data-testid="contact-confirmation"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="w-12 h-12 rounded-full bg-lime text-obsidian grid place-items-center mb-6" aria-hidden="true">
        <Check className="w-6 h-6" />
      </div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-3xl font-bold text-white mb-4 outline-none"
      >
        {t("contact.thankYou", { name: result.firstName })}
      </h2>
      {result.qualified ? (
        <>
          <p className="text-ink leading-relaxed mb-8">{t("contact.qualifiedBody")}</p>
          {isSafePublicBookingUrl(result.meetingUrl) ? (
            <a
              href={result.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("scheduling_cta_clicked", { provider: "calendly" })}
              className="inline-flex bg-lime text-obsidian px-6 py-3 rounded-xl font-bold"
              data-testid="contact-meeting-cta"
            >
              {t("contact.scheduleMeeting")}
            </a>
          ) : (
            <p className="text-ink leading-relaxed mb-8" data-testid="contact-meeting-unavailable">
              {t("contact.meetingUnavailable")}
            </p>
          )}
        </>
      ) : (
        <p className="text-ink leading-relaxed mb-8">{t("contact.standardBody")}</p>
      )}
      <p className="text-sm text-ink mt-8 font-mono">{t("contact.reference", { reference: result.reference })}</p>
      <span className="sr-only">{summary}</span>
    </div>
  );
}
