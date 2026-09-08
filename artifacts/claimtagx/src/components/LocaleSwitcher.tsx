import { useI18n, LOCALE_META, type Locale } from "@/lib/i18n";

export default function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();
  const options = Object.values(LOCALE_META);

  return (
    <div
      className={`flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] ${
        compact ? "p-0.5" : "p-1"
      }`}
    >
      {options.map((opt) => (
        <button
          key={opt.code}
          type="button"
          aria-pressed={locale === opt.code}
          onClick={() => setLocale(opt.code as Locale)}
          className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
            locale === opt.code
              ? "bg-lime text-obsidian"
              : "text-ink hover:text-white hover:bg-white/5"
          }`}
        >
          {opt.nativeLabel}
        </button>
      ))}
    </div>
  );
}
