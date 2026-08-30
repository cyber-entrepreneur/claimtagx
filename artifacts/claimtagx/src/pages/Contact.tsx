import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js/max";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import SEO from "@/components/SEO";
import { track } from "@/lib/analytics";
import {
  fetchBootstrap,
  submitInquiry,
  type ContactBootstrap,
  type TaxonomyItem,
} from "@/lib/contactApi";

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

function optionsFor(taxonomy: TaxonomyItem[], kind: string, parentKey?: string) {
  return taxonomy
    .filter((t) => t.kind === kind && (parentKey === undefined || t.parentKey === parentKey))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate/70 focus:outline-none focus:ring-2 focus:ring-lime/60 focus:border-lime/40";

export default function Contact() {
  const [boot, setBoot] = useState<ContactBootstrap | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [country, setCountry] = useState("");
  const [phoneNational, setPhoneNational] = useState("");
  const [useCases, setUseCases] = useState<string[]>([]);
  const [useCaseOther, setUseCaseOther] = useState("");
  const [qualOpen, setQualOpen] = useState(false);
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

  useEffect(() => {
    track("form_view", { form: "contact_us" });
    fetchBootstrap()
      .then((data) => {
        setBoot(data);
        if (data.detectedCountry) setCountry(data.detectedCountry);
      })
      .catch((err: Error) => setBootError(err.message));
  }, []);

  const selectedCountry = boot?.countries.find((c) => c.code === country);
  const callingCode = selectedCountry?.callingCode ?? "";

  const filteredCountries = useMemo(() => {
    if (!boot) return [];
    const q = countryQuery.trim().toLowerCase();
    if (!q) return boot.countries;
    return boot.countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.callingCode.includes(q),
    );
  }, [boot, countryQuery]);

  function markStarted() {
    if (started.current) return;
    started.current = true;
    track("form_start", { form: "contact_us" });
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

  function validate(form: FormData): Record<string, string> {
    const next: Record<string, string> = {};
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
    if (useCases.length === 0) next.useCase = "Select at least one use case.";
    if (useCases.includes("other") && !useCaseOther.trim()) next.useCaseOther = "Please specify your use case.";
    if (message.length < 10) next.message = "Tell us a little more so we can route your inquiry.";
    if (!consent) next.consent = "Please agree to the Terms and Privacy Policy.";
    return next;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
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
    track("submission_attempted", { form: "contact_us" });
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
        useCaseKeys: useCases.includes("mixed")
          ? useCases
          : useCases.slice(0, 1).concat(useCases.filter((k) => k === "other")),
        useCaseOther: useCases.includes("other") ? useCaseOther.trim() : undefined,
        message: String(form.get("message")).trim(),
        answers,
        termsAccepted: true,
        locale: navigator.language,
        attribution: attribution(),
        idempotencyKey: idempotencyKey.current,
        honeypot: String(form.get("companyWebsite") ?? ""),
      });
      track("submission_succeeded", { qualified: data.qualified });
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

  const useCaseOptions = boot ? optionsFor(boot.taxonomy, "use_case") : [];
  const questions = boot ? optionsFor(boot.taxonomy, "question") : [];
  const currentSolution = answers.current_solution?.optionKeys[0];

  return (
    <>
      <SEO
        title="Contact ClaimTagX"
        description="Contact ClaimTagX. We'll route your inquiry to the right team."
        url="https://claimtagx.com/contact"
      />
      <section className="relative min-h-[calc(100svh-4.5rem)] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh" />
        <div className="absolute inset-0 bg-grid-pattern opacity-40" />
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
                <noscript>
                  <p className="text-amber-200 text-sm">
                    JavaScript is required to validate your phone number and submit this form.
                  </p>
                </noscript>
                {bootError && (
                  <p role="alert" className="text-red-300 text-sm">
                    {bootError}
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="First name" name="firstName" error={errors.firstName} required />
                  <Field label="Last name" name="lastName" error={errors.lastName} required />
                </div>
                <Field label="Job title" name="jobTitle" error={errors.jobTitle} required />
                <Field label="Company name" name="companyName" error={errors.companyName} required />
                <Field label="Email address" name="email" type="email" error={errors.email} required autoComplete="email" />

                <div>
                  <label className="block text-sm font-medium text-white mb-2" id="country-label">
                    Country
                  </label>
                  <button
                    type="button"
                    aria-labelledby="country-label"
                    aria-expanded={countryOpen}
                    aria-haspopup="listbox"
                    onClick={() => setCountryOpen((v) => !v)}
                    className={`${fieldClass} flex items-center justify-between text-left`}
                  >
                    <span>
                      {selectedCountry
                        ? `${flagEmoji(selectedCountry.code)} ${selectedCountry.name}`
                        : "Select country"}
                    </span>
                    <ChevronDown className="w-4 h-4 text-slate" />
                  </button>
                  {countryOpen && (
                    <div className="mt-2 rounded-xl border border-white/10 bg-obsidian p-2 max-h-64 overflow-auto">
                      <input
                        value={countryQuery}
                        onChange={(e) => setCountryQuery(e.target.value)}
                        placeholder="Search country"
                        className={`${fieldClass} mb-2`}
                        aria-label="Search country"
                      />
                      <ul role="listbox" className="space-y-1">
                        {filteredCountries.map((c) => (
                          <li key={c.code}>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm"
                              onClick={() => {
                                setCountry(c.code);
                                setCountryOpen(false);
                                setPhoneNational("");
                              }}
                            >
                              {flagEmoji(c.code)} {c.name}
                              <span className="text-slate ml-2">{c.callingCode}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {boot?.detectedCountry && country === boot.detectedCountry && (
                    <p className="text-xs text-slate mt-2">Suggested from your network location. You can change it.</p>
                  )}
                  {errors.country && <p className="text-red-300 text-sm mt-1">{errors.country}</p>}
                </div>

                <div>
                  <span className="block text-sm font-medium text-white mb-2">Phone</span>
                  <div className="grid grid-cols-[7rem_1fr] gap-3">
                    <input
                      readOnly
                      value={callingCode || "+"}
                      aria-label="Country calling code"
                      className={`${fieldClass} font-mono`}
                    />
                    <input
                      name="phone"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="Area / mobile + number"
                      value={phoneNational}
                      onChange={(e) =>
                        setPhoneNational(formatNational(e.target.value, country))
                      }
                      className={fieldClass}
                    />
                  </div>
                  <p className="text-xs text-slate mt-2">
                    Include the local area or mobile prefix. We'll store an international number.
                  </p>
                  {errors.phone && <p className="text-red-300 text-sm mt-1">{errors.phone}</p>}
                </div>

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
                            if (opt.key === "mixed") {
                              setUseCases((prev) =>
                                prev.includes("mixed") ? prev.filter((k) => k !== "mixed") : [...prev, "mixed"],
                              );
                              return;
                            }
                            setUseCases((prev) => {
                              if (prev.includes("mixed")) {
                                return prev.includes(opt.key)
                                  ? prev.filter((k) => k !== opt.key)
                                  : [...prev, opt.key];
                              }
                              return prev.includes(opt.key) ? prev.filter((k) => k !== opt.key) : [opt.key];
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
                  {errors.useCaseOther && <p className="text-red-300 text-sm mt-2">{errors.useCaseOther}</p>}
                </fieldset>

                <div>
                  <label className="block text-sm font-medium text-white mb-2" htmlFor="message">
                    Message
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={6}
                    maxLength={boot?.messageMaxLength ?? 8000}
                    className={fieldClass}
                    placeholder="What should we know about your operation?"
                  />
                  {errors.message && <p className="text-red-300 text-sm mt-1">{errors.message}</p>}
                </div>

                <div className="border-t border-white/10 pt-6">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !qualOpen;
                      setQualOpen(next);
                      if (next) track("qualification_opened", {});
                    }}
                    className="flex items-center justify-between w-full text-left"
                    aria-expanded={qualOpen}
                  >
                    <div>
                      <p className="text-white font-semibold">Help us understand your requirements</p>
                      <p className="text-sm text-slate mt-1">Optional — helps us send a more relevant response.</p>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-slate transition ${qualOpen ? "rotate-180" : ""}`} />
                  </button>
                  {qualOpen && (
                    <div className="mt-6 space-y-8">
                      {questions.map((q) => {
                        const opts = optionsFor(boot!.taxonomy, "option", q.key);
                        const selected = answers[q.key]?.optionKeys ?? [];
                        const multi = q.key === "improvements" || q.key === "objectives";
                        return (
                          <fieldset key={q.key}>
                            <legend className="text-sm font-medium text-white mb-3">{q.label}</legend>
                            <div className="flex flex-wrap gap-2">
                              {opts.map((opt) => {
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
                            {q.key === "current_solution" &&
                              (currentSolution === "yes" || currentSolution === "partially") && (
                                <div className="mt-4 space-y-4">
                                  <input
                                    className={fieldClass}
                                    placeholder="Which solution do you currently use?"
                                    value={answers.current_solution?.freeText ?? ""}
                                    onChange={(e) =>
                                      setAnswer("current_solution", { freeText: e.target.value })
                                    }
                                  />
                                </div>
                              )}
                            {q.key === "objectives" && (
                              <textarea
                                className={`${fieldClass} mt-4`}
                                rows={3}
                                placeholder="Tell us more about your requirements (optional)"
                                value={answers.objectives?.freeText ?? ""}
                                onChange={(e) => setAnswer("objectives", { freeText: e.target.value })}
                              />
                            )}
                          </fieldset>
                        );
                      })}
                    </div>
                  )}
                </div>

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
                  disabled={submitting || !boot}
                  className="w-full sm:w-auto bg-lime text-obsidian px-8 py-3.5 rounded-xl font-bold disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {submitting ? "Submitting…" : "Submit"}
                </button>
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
          We've received your inquiry. A member of our team will review your message and respond as soon as possible.
        </p>
      )}
      <p className="text-sm text-slate mt-8 font-mono">Reference: {result.reference}</p>
    </div>
  );
}
