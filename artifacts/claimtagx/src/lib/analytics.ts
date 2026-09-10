// Marketing-site analytics with a three-destination fan-out:
//   1) PostHog       — product/funnel analytics, session replay
//   2) Google Analytics 4 — source, medium, UTM campaign, geo, device
//   3) ClaimTagX backend  — first-party stream into the sales team's portal
//
// Design rules:
//   * Nothing fires until the user accepts the cookie banner.
//   * Each destination is independent — if PostHog is unconfigured, GA4 and the
//     backend still work, and vice versa. Every helper is a safe no-op when
//     misconfigured.
//   * First-visit attribution (UTM, referrer, landing path) is captured once
//     per session and attached to every subsequent event.

import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
  'https://us.i.posthog.com';
const GA_ID = import.meta.env.VITE_GA_ID as string | undefined;
const BACKEND_ENDPOINT = import.meta.env.VITE_CLAIMTAGX_EVENTS_ENDPOINT as
  | string
  | undefined;
const CONSENT_KEY = 'claimtagx-cookie-consent';
const ANON_KEY = 'claimtagx-anon-id';
const SESSION_KEY = 'claimtagx-session-id';
const ATTRIBUTION_KEY = 'claimtagx-attribution';

interface Attribution {
  landing_path: string;
  referrer: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

let initialized = false;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function consentGranted(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(CONSENT_KEY) === 'accepted';
}

/** Optional marketing analytics (cookie banner). Independent of required terms consent. */
export function isOptionalAnalyticsConsentGranted(): boolean {
  return consentGranted();
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for ancient browsers — still RFC-4122-ish.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getAnonymousId(): string {
  let id = window.localStorage.getItem(ANON_KEY);
  if (!id) {
    id = uuid();
    window.localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

function getSessionId(): string {
  let id = window.sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uuid();
    window.sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function captureAttributionOnce(): Attribution {
  const existing = window.sessionStorage.getItem(ATTRIBUTION_KEY);
  if (existing) {
    try {
      return JSON.parse(existing) as Attribution;
    } catch {
      // fall through and re-capture
    }
  }
  const params = new URLSearchParams(window.location.search);
  const attribution: Attribution = {
    landing_path: window.location.pathname + window.location.search,
    referrer: document.referrer || '',
    utm_source: params.get('utm_source') ?? undefined,
    utm_medium: params.get('utm_medium') ?? undefined,
    utm_campaign: params.get('utm_campaign') ?? undefined,
    utm_term: params.get('utm_term') ?? undefined,
    utm_content: params.get('utm_content') ?? undefined,
  };
  window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
  return attribution;
}

function initGA(): void {
  if (!GA_ID || typeof window === 'undefined') return;
  if (window.gtag) return; // already loaded

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  }
  window.gtag = gtag;

  gtag('js', new Date());
  // anonymize_ip is automatic in GA4; advertising features stay off.
  gtag('config', GA_ID, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}

function initPostHog(): void {
  if (!POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
  });
}

/** Initialize all destinations if consent is in place. Safe to call repeatedly. */
export function initAnalytics(): void {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  if (!consentGranted()) return;

  captureAttributionOnce();
  initPostHog();
  initGA();
  initialized = true;
}

/** Called by the cookie banner when the user clicks Accept. */
export function enableAnalytics(): void {
  initAnalytics();
}

/** Called by the cookie banner when the user clicks Reject. */
export function disableAnalytics(): void {
  if (POSTHOG_KEY) posthog.opt_out_capturing();
  // No clean way to "uninit" GA in-place; the consent gate already kept us
  // from injecting the script, so this is purely a defensive opt-out for
  // anyone who toggles consent mid-session.
}

function sendToBackend(event: string, properties?: Record<string, unknown>): void {
  if (!BACKEND_ENDPOINT) return;
  const attribution = captureAttributionOnce();
  const payload = {
    event,
    occurredAt: new Date().toISOString(),
    anonymousId: getAnonymousId(),
    sessionId: getSessionId(),
    path: window.location.pathname + window.location.search,
    referrer: attribution.referrer,
    landingPath: attribution.landing_path,
    utm: {
      source: attribution.utm_source,
      medium: attribution.utm_medium,
      campaign: attribution.utm_campaign,
      term: attribution.utm_term,
      content: attribution.utm_content,
    },
    properties,
  };

  // sendBeacon survives page-unload (e.g. CTA click that navigates to a
  // new tab — though target=_blank doesn't unload, the pattern is still
  // the right default for analytics).
  const body = JSON.stringify(payload);
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon(BACKEND_ENDPOINT, blob)) return;
  }

  // Fallback: fire-and-forget fetch with keepalive.
  fetch(BACKEND_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {
    // Silently drop — analytics should never crash the page.
  });
}

/** Track a marketing-site event. Fans out to all configured destinations. */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;

  if (POSTHOG_KEY) {
    posthog.capture(event, properties);
  }
  if (window.gtag) {
    window.gtag('event', event, properties ?? {});
  }
  sendToBackend(event, properties);
}
