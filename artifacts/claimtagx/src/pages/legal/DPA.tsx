import SEO from '@/components/SEO';
import { useI18n } from '@/lib/i18n';
import { legalPageSeo } from '@/lib/seo/legalLocalization';

// Shell chrome is localized; legal body copy requires qualified human review before translation or publication as localized law.
export default function DPA() {
  const { t, locale } = useI18n();
  return (
    <>
      <SEO
        {...legalPageSeo("/dpa", locale === "ar" ? "ar" : "en", {
          title: t("legal.dpa.seoTitle"),
          description: t("legal.dpa.seoDescription"),
        })}
      />
      <div className="pt-32 pb-20 max-w-[800px] mx-auto px-4 sm:px-6">
        <h1 className="text-4xl font-bold text-white mb-2">{t('legal.dpa.title')}</h1>
        <p className="text-ink text-sm mb-10 pb-10 border-b border-white/10">{t('legal.lastUpdatedLower', { date: 'April 17, 2026' })}</p>

        <div className="prose prose-invert prose-slate max-w-none text-ink-300">
          <p>This Data Processing Addendum ("DPA") forms part of the Terms of Service between ClaimTagX ("Processor") and the Customer ("Controller").</p>
          
          <h2 className="text-2xl font-bold text-white mt-8 mb-4">1. Scope of Processing</h2>
          <p>The Processor will process Personal Data solely to provide the Services in accordance with the Controller's documented instructions as outlined in the Agreement.</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">2. Sub-processors</h2>
          <p>The Controller authorizes the Processor to engage sub-processors to assist in providing the Services. The Processor remains liable for the acts and omissions of its sub-processors.</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">3. Security Measures</h2>
          <p>The Processor implements appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including encryption and multi-tenant isolation architectures.</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">4. Data Breach Notification</h2>
          <p>The Processor will notify the Controller without undue delay upon becoming aware of a Personal Data Breach affecting the Controller's data.</p>
        </div>
      </div>
    </>
  );
}
