import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js/max";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import SEO from "@/components/SEO";
import { track } from "@/lib/analytics";
import { fetchBootstrap, submitInquiry } from "@/lib/contactApi";
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
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate/70 focus:outline-none focus:ring-2 focus:ring-lime/60 focus:border-lime/40";

export default function Contact() {
  const [countries] = useState(COUNTRIES);
  const [useCaseOptions, setUseCaseOptions] = useState(() => useCasesFromTaxonomy([]));
  const [salesQuestions, setSalesQuestions] = useState<CatalogQuestion[]>(() =>
    questionsFromTaxonomy([]),
  );
  const [inquiryType, setInquiryType] = useState<InquiryType | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
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
  const started = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const countryBoxRef = useRef<HTMLDivElement>(null);

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

  function validate(form: FormData): Record<string, string> {
    const next: Record<string, string> = {};
    if (!inquiryType) next.inquiryType = "Select what this inquiry is about.";
    const firstName = String(form.get("firstName") ?? "").trim();
    const lastName = String(form.get("lastName") ?? "").trim();
    const jobTitle = String(form.get("jobTitle") ?? "").trim();
    const companyName = String(form.get("companyName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    if (!firstName) next.firstName = "Enter your first name.";
    if (!lastName) next.lastName = "Enter your last name.";
    if (!jobTitle) next.jobTitle = "Enter your job title.";
    if (!companyName) next.companyName = "Enter your company name.";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email address.";
    if (!country) next.country = "Select your country.";
    const parsed = country
      ? parsePhoneNumberFromString(`${callingCode} ${phoneNational}`, country as never)
      : undefined;
    if (!parsed?.isValid()) next.phone = "Enter a valid phone number for the selected country.";
    if (inquiryType === "sales") {
      if (useCases.length === 0) next.useCase = "Select at least one use case.";
      if (useCases.includes("other") && !useCaseOther.trim()) {
        next.useCaseOther = "Please specify your use case.";
      }
    }
    if (message.length < 10) next.message = "Tell us a little more so we can route your inquiry.";
    if (!consent) next.consent = "Please agree to the Terms and Privacy Policy.";
    return next;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || !inquiryType) return;
    const form = new FormData(e.currentTarget);
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      track("form_field_error", { fields: Object.keys(nextErrors) });
      const first = Object.keys(nextErrors)[0];
      e.currentTarget.querySelector(`[name="${first}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
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
        attribution: { ...attribution(), inquiry_type: inquiryType },
        idempotencyKey: idempotencyKey.current,
        honeypot: String(form.get("companyWebsite") ?? ""),
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
      setSubmitError(
        err instanceof Error
          ? err.message
          : "We couldn't submit your inquiry. Your information has been preserved. Please try again.",
      );
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

  return (
    <>
      <SEO
        title="Contact ClaimTagX"
        description="Contact ClaimTagX. We'll route your inquiry to the right team."
        url="https://claimtagx.com/contact"
      />
      <section className="relative min-h-[calc(100svh-4.5rem)]">
        <div className="absolute inset-0 bg-gradient-mesh pointer-events-none" />
        <div className="absolute inset-0 bg-grid-pattern opacity-40 pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 md:pt-32 pb-20 grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-12 lg:gap-16 items-start">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="lg:sticky lg:top-28"
          >
            <p className="text-lime font-mono text-xs tracking-[0.2em] uppercase mb-4">Contact</p>
            <h1 className="text-4xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.05] mb-6">
              Contact ClaimTagX
            </h1>
            <p className="text-lg text-slate max-w-md leading-relaxed">
              Tell us about your operation. We'll route your inquiry to the person who can actually help.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
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
              >
                <fieldset>
                  <legend className="text-sm font-medium text-white mb-3">
                    What can we help you with?
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {INQUIRY_TYPES.map((opt) => {
                      const on = inquiryType === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          name="inquiryType"
                          aria-pressed={on}
                          onClick={() => selectInquiryType(opt.key)}
                          className={`px-3 py-2 rounded-full text-sm border transition ${
                            on
                              ? "bg-lime text-obsidian border-lime"
                              : "border-white/10 text-slate hover:border-lime/40 hover:text-white"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {errors.inquiryType && (
                    <p className="text-red-300 text-sm mt-2">{errors.inquiryType}</p>
                  )}
                </fieldset>

                {inquiryType && (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field label="First name" name="firstName" error={errors.firstName} required />
                      <Field label="Last name" name="lastName" error={errors.lastName} required />
                    </div>
                    <Field label="Job title" name="jobTitle" error={errors.jobTitle} required />
                    <Field
                      label="Company name"
                      name="companyName"
                      error={errors.companyName}
                      required
                    />
                    <Field
                      label="Email address"
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
                            Country
                          </label>
                          <div className="relative">
                            <input
                              id="country-search"
                              name="country"
                              autoComplete="country-name"
                              value={
                                countryOpen
                                  ? countryQuery
                                  : selectedCountry
                                    ? selectedCountry.name
                                    : countryQuery
                              }
                              placeholder="Search country"
                              onFocus={() => {
                                setCountryOpen(true);
                                setCountryQuery("");
                              }}
                              onChange={(e) => {
                                setCountryOpen(true);
                                setCountryQuery(e.target.value);
                                markStarted();
                              }}
                              className={`${fieldClass} pr-10`}
                              aria-expanded={countryOpen}
                              aria-controls="country-list"
                              aria-autocomplete="list"
                              role="combobox"
                            />
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate" />
                          </div>
                          {countryOpen && (
                            <ul
                              id="country-list"
                              role="listbox"
                              className="absolute left-0 right-0 mt-2 z-50 max-h-64 overflow-auto rounded-xl border border-white/10 bg-[#0B1220] p-2 shadow-2xl"
                            >
                              {filteredCountries.length === 0 ? (
                                <li className="px-3 py-2 text-sm text-slate">No matching country.</li>
                              ) : (
                                filteredCountries.map((c) => (
                                  <li key={c.code} role="option" aria-selected={c.code === country}>
                                    <button
                                      type="button"
                                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm text-white"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => pickCountry(c.code)}
                                    >
                                      {flagEmoji(c.code)} {c.name}
                                      <span className="text-slate ml-2">{c.callingCode}</span>
                                    </button>
                                  </li>
                                ))
                              )}
                            </ul>
                          )}
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-white mb-2" htmlFor="calling-code">
                            Code
                          </label>
                          <input
                            id="calling-code"
                            readOnly
                            value={callingCode || "+"}
                            aria-label="Country calling code"
                            className={`${fieldClass} font-mono text-center px-2`}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-white mb-2" htmlFor="phone">
                            Phone number
                          </label>
                          <input
                            id="phone"
                            name="phone"
                            inputMode="tel"
                            autoComplete="tel-national"
                            placeholder="Mobile / local number"
                            value={phoneNational}
                            onChange={(e) =>
                              setPhoneNational(formatNational(e.target.value, country))
                            }
                            className={fieldClass}
                          />
                        </div>
                      </div>
                      {detectedCountry && country === detectedCountry && (
                        <p className="text-xs text-slate mt-2">
                          Country suggested from your network location. You can change it.
                        </p>
                      )}
                      {errors.country && <p className="text-red-300 text-sm mt-1">{errors.country}</p>}
                      {errors.phone && <p className="text-red-300 text-sm mt-1">{errors.phone}</p>}
                    </div>

                    {inquiryType === "sales" && (
                      <fieldset>
                        <legend className="text-sm font-medium text-white mb-3">
                          What do you use claim tag tickets for?
                        </legend>
                        <div className="flex flex-wrap gap-2">
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
                                    : "border-white/10 text-slate hover:border-lime/40 hover:text-white"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        {useCases.includes("other") && (
                          <input
                            className={`${fieldClass} mt-3`}
                            placeholder="Please specify"
                            value={useCaseOther}
                            onChange={(e) => setUseCaseOther(e.target.value)}
                          />
                        )}
                        {errors.useCase && <p className="text-red-300 text-sm mt-2">{errors.useCase}</p>}
                        {errors.useCaseOther && (
                          <p className="text-red-300 text-sm mt-2">{errors.useCaseOther}</p>
                        )}
                      </fieldset>
                    )}

                    {messageCopy && (
                      <div>
                        <label className="block text-sm font-medium text-white mb-2" htmlFor="message">
                          {messageCopy.label}
                        </label>
                        <textarea
                          id="message"
                          name="message"
                          rows={6}
                          maxLength={8000}
                          className={fieldClass}
                          placeholder={messageCopy.placeholder}
                        />
                        {errors.message && (
                          <p className="text-red-300 text-sm mt-1">{errors.message}</p>
                        )}
                      </div>
                    )}

                    {inquiryType === "sales" && (
                      <div className="border-t border-white/10 pt-6 space-y-8">
                        <div>
                          <p className="text-white font-semibold">
                            Help us understand your requirements
                          </p>
                          <p className="text-sm text-slate mt-1">
                            Optional — these questions help us send a more relevant response. You can
                            skip any of them.
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
                                          : "border-white/10 text-slate hover:text-white"
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
                                  placeholder="Which solution do you currently use?"
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
                                          : "border-white/10 text-slate hover:text-white"
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

                    <label className="flex items-start gap-3 text-sm text-slate">
                      <input
                        type="checkbox"
                        className="mt-1 accent-[#C6F24E]"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        I agree to the{" "}
                        <Link href="/terms" className="text-lime underline underline-offset-2">
                          Terms &amp; Conditions
                        </Link>{" "}
                        and acknowledge the{" "}
                        <Link href="/privacy" className="text-lime underline underline-offset-2">
                          Privacy Policy
                        </Link>
                        .
                      </span>
                    </label>
                    {errors.consent && <p className="text-red-300 text-sm">{errors.consent}</p>}

                    <div className="hidden" aria-hidden="true">
                      <input name="companyWebsite" tabIndex={-1} autoComplete="off" />
                    </div>

                    {submitError && (
                      <p role="alert" className="text-red-300 text-sm">
                        {submitError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full sm:w-auto bg-lime text-obsidian px-8 py-3.5 rounded-xl font-bold disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      {submitting ? "Submitting…" : "Submit"}
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
  return (
    <div>
      <label className="block text-sm font-medium text-white mb-2" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        className={fieldClass}
      />
      {error && (
        <p className="text-red-300 text-sm mt-1" role="alert">
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
  return (
    <div className="rounded-[2rem] border border-white/10 bg-steel/30 p-8 md:p-12">
      <div className="w-12 h-12 rounded-full bg-lime text-obsidian grid place-items-center mb-6">
        <Check className="w-6 h-6" />
      </div>
      <h2 className="text-3xl font-bold text-white mb-4">Thank you, {result.firstName}.</h2>
      {result.qualified ? (
        <>
          <p className="text-slate leading-relaxed mb-8">
            We've received your inquiry and would be happy to discuss your requirements.
          </p>
          {result.meetingUrl && (
            <a
              href={result.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("scheduling_cta_clicked", {})}
              className="inline-flex bg-lime text-obsidian px-6 py-3 rounded-xl font-bold"
            >
              Schedule a Meeting
            </a>
          )}
        </>
      ) : (
        <p className="text-slate leading-relaxed mb-8">
          We've received your inquiry. A member of our team will review your message and respond as
          soon as possible.
        </p>
      )}
      <p className="text-sm text-slate mt-8 font-mono">Reference: {result.reference}</p>
    </div>
  );
}
