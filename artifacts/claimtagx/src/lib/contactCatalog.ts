import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import type { CountryOption, TaxonomyItem } from "./contactApi";

export interface CatalogOption {
  key: string;
  label: string;
}

export interface CatalogQuestion {
  key: string;
  label: string;
  multiple?: boolean;
  options: CatalogOption[];
}

export const DEFAULT_USE_CASES: CatalogOption[] = [
  { key: "vehicles", label: "Vehicles" },
  { key: "baggage", label: "Baggage" },
  { key: "cloaks", label: "Cloaks" },
  { key: "hardware", label: "Hardware" },
  { key: "equipment", label: "Equipment" },
  { key: "mixed", label: "Mixed Use" },
  { key: "other", label: "Other" },
];

export const DEFAULT_QUESTIONS: CatalogQuestion[] = [
  {
    key: "current_solution",
    label: "Do you currently use a digital claim tag or ticketing solution?",
    options: [
      { key: "yes", label: "Yes" },
      { key: "no", label: "No" },
      { key: "partially", label: "Partially / in some locations" },
    ],
  },
  {
    key: "improvements",
    label: "What would you most like to improve about your current solution?",
    multiple: true,
    options: [
      { key: "customer_experience", label: "Customer experience" },
      { key: "speed", label: "Speed of operation" },
      { key: "loss_disputes", label: "Loss / dispute management" },
      { key: "traceability", label: "Traceability and auditability" },
      { key: "accountability", label: "Staff accountability" },
      { key: "reporting", label: "Reporting and analytics" },
      { key: "integration", label: "Integration with existing systems" },
      { key: "cost", label: "Cost" },
      { key: "reliability", label: "Reliability" },
      { key: "paper_reduction", label: "Paper reduction" },
      { key: "other", label: "Other" },
    ],
  },
  {
    key: "objectives",
    label: "What are you looking to achieve with ClaimTagX?",
    multiple: true,
    options: [
      { key: "replace_paper", label: "Replace paper claim tickets" },
      { key: "replace_digital", label: "Replace an existing digital system" },
      { key: "improve_cx", label: "Improve customer experience" },
      { key: "improve_traceability", label: "Improve custody traceability" },
      { key: "reduce_disputes", label: "Reduce lost-item / lost-key disputes" },
      { key: "improve_accountability", label: "Improve employee accountability" },
      { key: "operational_visibility", label: "Improve operational visibility" },
      { key: "improve_reporting", label: "Improve reporting" },
      { key: "standardize", label: "Standardize operations across multiple locations" },
      { key: "integrate", label: "Integrate claim management into another system" },
      { key: "new_operation", label: "Explore ClaimTagX for a new operation" },
      { key: "other", label: "Other" },
    ],
  },
  {
    key: "volume",
    label: "Approximately how many claim tag transactions do you handle?",
    options: [
      { key: "lt_1000", label: "Less than 1,000 / month" },
      { key: "1000_5000", label: "1,000–5,000 / month" },
      { key: "5001_25000", label: "5,001–25,000 / month" },
      { key: "25001_100000", label: "25,001–100,000 / month" },
      { key: "100001_500000", label: "100,001–500,000 / month" },
      { key: "500001_plus", label: "More than 500,000 / month" },
      { key: "not_sure", label: "Not sure" },
    ],
  },
  {
    key: "locations",
    label: "How many locations would potentially use ClaimTagX?",
    options: [
      { key: "1", label: "1" },
      { key: "2_5", label: "2–5" },
      { key: "6_20", label: "6–20" },
      { key: "21_50", label: "21–50" },
      { key: "51_100", label: "51–100" },
      { key: "100_plus", label: "100+" },
      { key: "not_sure", label: "Not sure" },
    ],
  },
  {
    key: "timeline",
    label: "When are you considering implementing a solution?",
    options: [
      { key: "immediately", label: "Immediately" },
      { key: "within_1_month", label: "Within 1 month" },
      { key: "1_3_months", label: "1–3 months" },
      { key: "3_6_months", label: "3–6 months" },
      { key: "6_12_months", label: "6–12 months" },
      { key: "more_than_12_months", label: "More than 12 months" },
      { key: "just_exploring", label: "Just exploring" },
    ],
  },
];

export function buildCountryList(): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  return getCountries()
    .map((code) => ({
      code,
      name: names?.of(code) ?? code,
      callingCode: `+${getCountryCallingCode(code)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function localeCountryGuess(): string | null {
  const locale = typeof navigator !== "undefined" ? navigator.language : "";
  const region = locale.split("-")[1];
  if (region && region.length === 2) return region.toUpperCase();
  return null;
}

export function questionsFromTaxonomy(taxonomy: TaxonomyItem[]): CatalogQuestion[] {
  const questions = taxonomy
    .filter((t) => t.kind === "question" && t.active !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (questions.length === 0) return DEFAULT_QUESTIONS;
  return questions.map((q) => ({
    key: q.key,
    label: q.label,
    multiple: q.key === "improvements" || q.key === "objectives",
    options: taxonomy
      .filter((t) => t.kind === "option" && t.parentKey === q.key && t.active !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ key: t.key, label: t.label })),
  }));
}

export function useCasesFromTaxonomy(taxonomy: TaxonomyItem[]): CatalogOption[] {
  const rows = taxonomy
    .filter((t) => t.kind === "use_case" && t.active !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (rows.length === 0) return DEFAULT_USE_CASES;
  return rows.map((t) => ({ key: t.key, label: t.label }));
}
