export type Locale = "en" | "ar";

export type LocaleMeta = {
  code: Locale;
  label: string;
  nativeLabel: string;
  dir: "ltr" | "rtl";
  hrefLang: string;
};

export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

export type InterpolationValues = Record<string, string | number>;
