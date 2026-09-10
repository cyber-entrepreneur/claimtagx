import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { ar } from "./locales/ar";
import { en } from "./locales/en";
import type { InterpolationValues, Locale, LocaleMeta, TranslationTree } from "./types";

const STORAGE_KEY = "claimtagx-locale";

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { code: "en", label: "English", nativeLabel: "English", dir: "ltr", hrefLang: "en" },
  ar: { code: "ar", label: "Arabic", nativeLabel: "العربية", dir: "rtl", hrefLang: "ar" },
};

const DICTIONARIES: Record<Locale, TranslationTree> = { en, ar };

function readPathLocale(path: string): Locale | null {
  if (path === "/ar" || path.startsWith("/ar/")) return "ar";
  return null;
}

function lookup(tree: TranslationTree, key: string): string | undefined {
  const value = key.split(".").reduce<string | TranslationTree | undefined>((node, part) => {
    if (typeof node === "string" || node === undefined) return undefined;
    return node[part];
  }, tree);
  return typeof value === "string" ? value : undefined;
}

function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, token: string) => String(values[token] ?? `{${token}}`));
}

export function localeFromPath(path: string): Locale {
  return readPathLocale(path) ?? "en";
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  const meta = LOCALE_META[locale];
  document.documentElement.lang = meta.hrefLang;
  document.documentElement.dir = meta.dir;
  document.documentElement.dataset.locale = locale;
}

function pathLocaleOrEnglish(path: string): Locale {
  // URL prefix is authoritative. Stored preference must not paint Arabic onto
  // an English path (or the reverse) before the location effect runs.
  return localeFromPath(path);
}

export function stripLocalePrefix(path: string): string {
  if (path === "/ar") return "/";
  if (path.startsWith("/ar/")) return path.slice(3) || "/";
  return path;
}

export function withLocalePrefix(path: string, locale: Locale): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (locale === "en") return normalized;
  if (normalized === "/") return "/ar";
  return `/ar${normalized}`;
}

type I18nContextValue = {
  locale: Locale;
  dir: "ltr" | "rtl";
  meta: LocaleMeta;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: InterpolationValues) => string;
  localizedPath: (path: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function pathFromWindowOrRouter(routerPath: string): string {
  if (typeof window !== "undefined" && window.location?.pathname) {
    return window.location.pathname;
  }
  return routerPath;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [locale, setLocaleState] = useState<Locale>(() => pathLocaleOrEnglish(pathFromWindowOrRouter(location)));

  applyDocumentLocale(locale);

  useEffect(() => {
    const fromPath = pathLocaleOrEnglish(pathFromWindowOrRouter(location));
    if (fromPath !== locale) setLocaleState(fromPath);
  }, [location, locale]);

  useEffect(() => {
    applyDocumentLocale(locale);
    window.localStorage.setItem(STORAGE_KEY, locale);
    let cancelled = false;
    const markReady = () => {
      if (cancelled) return;
      applyDocumentLocale(locale);
      document.documentElement.dataset.appReady = "1";
    };
    const afterFonts = () => {
      requestAnimationFrame(() => requestAnimationFrame(markReady));
    };
    const fallback = window.setTimeout(afterFonts, 2500);
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        window.clearTimeout(fallback);
        afterFonts();
      }).catch(() => {
        window.clearTimeout(fallback);
        afterFonts();
      });
    } else {
      afterFonts();
    }
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      const base = stripLocalePrefix(location);
      navigate(withLocalePrefix(base, next));
    },
    [location, navigate],
  );

  const t = useCallback(
    (key: string, values?: InterpolationValues) => {
      const primary = lookup(DICTIONARIES[locale], key);
      const fallback = lookup(DICTIONARIES.en, key);
      return interpolate(primary ?? fallback ?? key, values);
    },
    [locale],
  );

  const localizedPath = useCallback((path: string) => withLocalePrefix(path, locale), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir: LOCALE_META[locale].dir,
      meta: LOCALE_META[locale],
      setLocale,
      t,
      localizedPath,
    }),
    [locale, setLocale, t, localizedPath],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
