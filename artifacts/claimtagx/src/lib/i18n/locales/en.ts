import type { TranslationTree } from "../types";
import { homeEn } from "./home.en";
import { solutionsEn } from "./solutions.en";

export const en: TranslationTree = {
  common: {
    retry: "Retry",
    offline: "You appear to be offline. Check your connection and try again.",
    skipToMain: "Skip to main content",
    loadingWorkspace: "Loading workspace…",
    submit: "Submit",
    submitting: "Submitting…",
  },
  nav: {
    howItWorks: "How it works",
    features: "Features",
    industries: "Industries",
    contact: "Contact Us",
    pricing: "Pricing",
    bookDemo: "Book a demo",
    startFree: "Start free",
  },
  contact: {
    eyebrow: "Contact",
    title: "Contact ClaimTagX",
    subtitle: "Tell us about your operation. We'll route your inquiry to the person who can actually help.",
    preferEmail: "Prefer email?",
    sendEmail: "Send us an Email",
    inquiryAbout: "What is this inquiry about?",
    helpWith: "What can we help you with?",
    firstName: "First name",
    lastName: "Last name",
    jobTitle: "Job title",
    companyName: "Company name",
    email: "Email address",
    country: "Country",
    phone: "Phone number",
    message: "Message",
    searchCountry: "Search country",
    callingCode: "Country calling code",
    code: "Code",
    required: "required",
    countryDetectedHint: "Country suggested from your network location. You can change it.",
    countrySelectHint: "Select the country that matches your phone number.",
    phonePlaceholder: "Mobile / local number",
    useCaseLegend: "What do you use claim tag tickets for?",
    useCaseOtherPlaceholder: "Please specify",
    competitorPlaceholder: "Which solution do you currently use?",
    salesHelpTitle: "Help us understand your requirements",
    salesHelpSubtitle:
      "Optional — these questions help us send a more relevant response. You can skip any of them.",
    consentPrefix: "I agree to the",
    terms: "Terms & Conditions",
    consentMiddle: "and acknowledge the",
    privacy: "Privacy Policy",
    consentNote:
      "We use the details you provide only to respond to this inquiry and to route it to the right team. We do not sell your information.",
    responseTime: "We typically respond within one business day.",
    orEmail: "Or",
    fixIssues: "Please fix the following issue",
    fixIssuesPlural: "Please fix the following issues",
    thankYou: "Thank you, {name}.",
    qualifiedBody: "We've received your inquiry and would be happy to discuss your requirements.",
    scheduleMeeting: "Schedule a Meeting",
    meetingUnavailable:
      "We received your inquiry. A specialist will follow up with scheduling options if a live booking link is not available.",
    standardBody:
      "We've received your inquiry. A member of our team will review your message and respond as soon as possible.",
    reference: "Reference: {reference}",
    inquiryTypes: {
      sales: "Sales",
      general: "General Inquiry",
      technical: "Technical Support",
      billing: "Billing Issues",
      other: "Other",
    },
    errors: {
      inquiryType: "Select what this inquiry is about.",
      firstName: "Enter your first name.",
      lastName: "Enter your last name.",
      jobTitle: "Enter your job title.",
      companyName: "Enter your company name.",
      email: "Enter a valid email address.",
      noMatchingCountry: "No matching country.",
      phone: "Enter a valid phone number for the selected country.",
      useCase: "Select at least one use case.",
      useCaseOther: "Please specify your use case.",
      message: "Tell us a little more so we can route your inquiry.",
      consent: "Please agree to the Terms and Privacy Policy.",
      submitGeneric:
        "We couldn't submit your inquiry. Your information has been preserved. Please try again.",
      badRequest: "Some details look invalid. Review the highlighted fields and try again.",
      conflict: "This submission was already received. If you need to change something, contact us directly.",
      rateLimit: "Too many attempts. Please wait a moment and try again.",
      server: "Our systems are temporarily unavailable. Please try again shortly.",
      unavailable: "The contact service is temporarily unavailable. Please try again shortly.",
      networkUncertain:
        "The connection dropped. Your inquiry may already have been received. Do not submit a new form. Wait for a confirmation email or contact us if none arrives.",
      securityCheck: "Complete the security check before sending.",
    },
  },
  footer: {
    tagline: "Replace paper claim tickets with cryptographically signed digital tags.",
    product: "Product",
    features: "Features",
    pricing: "Pricing",
    industries: "Industries",
    howItWorks: "How it works",
    solutions: "Solutions",
    hotels: "Hotels & Resorts",
    clubs: "Clubs & Restaurants",
    beachClubs: "Beach Clubs",
    valet: "Valet Parking",
    dryCleaning: "Dry Cleaning",
    luggage: "Luggage Check",
    repair: "Repair Services",
    airlines: "Airlines",
    company: "Company",
    contact: "Contact Us",
    sendEmail: "Send us an Email",
    legal: "Legal",
    security: "Security & Trust",
    privacy: "Privacy Policy",
    terms: "Terms of Use",
    refund: "Refund Policy",
    cookies: "Cookie Policy",
    gdpr: "GDPR",
    dpa: "Data Processing",
    aup: "Acceptable Use",
    copyright: "© {year} ClaimTagX. All rights reserved.",
  },
  pages: {
    notFoundTitle: "Page not found",
    notFoundBody: "The page you requested does not exist or may have moved.",
    notFoundCta: "Return home",
    pricingTitle: "Pricing — ClaimTagX",
    pricingDescription:
      "Five tiers built to scale with your operation. Start free. Upgrade when you outgrow it. No per-ticket fees.",
    securityTitle: "ClaimTagX Security",
    securityDescription: "How ClaimTagX protects custody data, tickets, and operator access.",
  },
  security: {
    hero: {
      eyebrow: "Security & Trust",
      titleBefore: "Built for the operations you",
      titleHighlight: "can't afford to lose.",
      subtitle:
        "Custody records are evidence. ClaimTagX protects yours with cryptographic ticket integrity, strict tenant isolation, and an audit trail your team — and your insurer — can rely on.",
      ctaDocs: "Request security documentation",
      ctaDetails: "Read the details",
    },
    pillars: {
      tamper: {
        title: "Tamper-proof tickets",
        plain:
          "Every ticket carries a cryptographic signature. A stale screenshot, a forged stub, or a tampered record fails verification — mathematically.",
        technical:
          "Ed25519 digital signatures on every issued ticket. Signature is verified at release; mismatch blocks the release and writes a flagged event to the audit log.",
      },
      isolation: {
        title: "Your data, your instance",
        plain:
          "One tenant cannot see another tenant — ever. Your tickets, photos, handlers, and audit trail live in a strictly isolated slice of the database.",
        technical:
          "Multi-tenant isolation enforced at the database layer via row-level security on PostgreSQL. Every query is scoped to the tenant by policy, not by application logic.",
      },
      audit: {
        title: "Append-only audit trail",
        plain:
          "Every intake, transfer, and release is logged with who, what, when, and where. Logs are write-once — they can never be edited or deleted from the application.",
        technical:
          "Append-only event log per tenant. Each event is timestamped, attributed to a handler, and linked to the asset. Exportable for insurance review or regulator inquiry.",
      },
      encryption: {
        title: "Encryption in transit and at rest",
        plain:
          "Your data is encrypted whenever it moves over the network and whenever it sits on disk. No plaintext between your team and your records.",
        technical:
          "TLS 1.2+ for all traffic; database and storage volumes encrypted at rest by the underlying infrastructure provider.",
      },
      infra: {
        title: "Infrastructure agnostic",
        plain:
          "Deploy ClaimTagX where it makes sense for your operation — our hosted public cloud for fastest time to value, your private cloud, or fully on-premise. The platform is the same; only the environment changes.",
        technical:
          "Public cloud (managed), private cloud (BYOC, customer-owned), and on-premise deployment all supported. Containerized, infrastructure-agnostic architecture. Enterprise customers choose the model at onboarding.",
      },
      privacy: {
        title: "Built for global data-protection laws",
        plain:
          "Wherever you operate, your custody records need to live within the rules. ClaimTagX is built to support data-protection and privacy regimes across every region we serve — and to give regulated operators the controls they need to prove it.",
        technical:
          "Designed to operate in alignment with data-protection and privacy frameworks across the United States, European Union, United Kingdom, GCC, Levant, broader Asia, Africa, and Australia. Data residency pinning and sovereign deployment available on Enterprise.",
      },
    },
    certifications: {
      eyebrow: "Certifications & Compliance",
      title: "Honest status on the standards your procurement team will ask about.",
      subtitle:
        "We tell you what's done, what's in progress, and what's on the roadmap — rather than pretending everything is ready.",
      roadmap: "Roadmap",
      availableNow: "Available now",
      soc2: {
        title: "SOC 2 Type II",
        body: "In planning. Contact sales for current readiness status and timeline.",
      },
      iso27001: {
        title: "ISO 27001",
        body: "On the roadmap for enterprise deployments. Contact sales for the latest.",
      },
      customDpa: {
        title: "Custom DPA",
        body: "Enterprise customers can request a Data Processing Addendum tailored to their environment.",
      },
    },
    legalDocs: {
      title: "Legal & policy documents",
      subtitle: "The complete legal posture, available to anyone — no NDA required.",
      privacy: {
        label: "Privacy Policy",
        desc: "How we collect, use, and protect personal data.",
      },
      terms: {
        label: "Terms of Service",
        desc: "The agreement governing your use of ClaimTagX.",
      },
      gdpr: {
        label: "GDPR Statement",
        desc: "How we comply with EU data protection law.",
      },
      dpa: {
        label: "Data Processing Addendum",
        desc: "For enterprise customers and EU data controllers.",
      },
      cookies: {
        label: "Cookie Policy",
        desc: "Which cookies we use and why.",
      },
      aup: {
        label: "Acceptable Use Policy",
        desc: "What the platform may and may not be used for.",
      },
    },
    cta: {
      title: "Reviewing ClaimTagX for an enterprise rollout?",
      body: "We work with procurement and security teams directly. Architecture diagrams, data-flow maps, vendor security questionnaires, and custom DPAs available on request.",
      button: "Talk to our team",
    },
  },
  // Shell chrome only — legal body copy requires qualified human review before translation or publication as localized law.
  legal: {
    effectiveDate: "Effective Date: {date}",
    lastUpdated: "Last Updated: {date}",
    lastUpdatedLower: "Last updated: {date}",
    privacy: {
      title: "Privacy Policy",
      seoTitle: "Privacy Policy | ClaimTagX",
      seoDescription: "How ClaimTagX collects, processes, stores, and protects personal data.",
    },
    terms: {
      title: "Terms of Service",
      seoTitle: "Terms of Service | ClaimTagX",
      seoDescription: "Terms governing access to and use of the ClaimTagX platform.",
    },
    refund: {
      title: "Refund Policy",
      seoTitle: "Refund Policy | ClaimTagX",
      seoDescription: "Refund eligibility and conditions for ClaimTagX subscriptions and Tenant-provided services.",
    },
    cookies: {
      title: "Cookie Policy",
      seoTitle: "Cookie Policy | ClaimTagX",
      seoDescription: "Cookie Policy for ClaimTagX.",
    },
    gdpr: {
      title: "GDPR Compliance",
      seoTitle: "GDPR Compliance | ClaimTagX",
      seoDescription: "GDPR compliance information for ClaimTagX.",
    },
    dpa: {
      title: "Data Processing Addendum",
      seoTitle: "Data Processing Addendum | ClaimTagX",
      seoDescription: "Data Processing Addendum for ClaimTagX.",
    },
    aup: {
      title: "Acceptable Use Policy",
      seoTitle: "Acceptable Use Policy | ClaimTagX",
      seoDescription: "Acceptable Use Policy for ClaimTagX.",
    },
  },
  home: homeEn,
  solutions: solutionsEn,
};
