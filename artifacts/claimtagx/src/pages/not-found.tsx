import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t, localizedPath } = useI18n();
  return (
    <div className="min-h-[60vh] w-full flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <div className="mb-4 flex justify-center">
          <AlertCircle className="h-10 w-10 text-lime" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-paper">{t("pages.notFoundTitle")}</h1>
        <p className="mt-3 text-sm text-ink">{t("pages.notFoundBody")}</p>
        <Link
          href={localizedPath("/")}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-lime px-4 py-2 text-sm font-semibold text-obsidian"
        >
          {t("pages.notFoundCta")}
        </Link>
      </div>
    </div>
  );
}
