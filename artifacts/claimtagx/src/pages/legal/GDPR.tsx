import SEO from '@/components/SEO';
import { useI18n } from '@/lib/i18n';
import { legalPageSeo } from '@/lib/seo/legalLocalization';

// Shell chrome is localized; legal body copy requires qualified human review before translation or publication as localized law.
export default function GDPR() {
  const { t, locale } = useI18n();
  return (
    <>
      <SEO
        {...legalPageSeo("/gdpr", locale === "ar" ? "ar" : "en", {
          title: t("legal.gdpr.seoTitle"),
          description: t("legal.gdpr.seoDescription"),
        })}
      />
      <div className="pt-32 pb-20 max-w-[800px] mx-auto px-4 sm:px-6">
        <h1 className="text-4xl font-bold text-white mb-2">{t('legal.gdpr.title')}</h1>
        <p className="text-ink text-sm mb-10 pb-10 border-b border-white/10">{t('legal.lastUpdatedLower', { date: 'April 17, 2026' })}</p>

        <div className="prose prose-invert prose-slate max-w-none text-ink-300">
          <p>ClaimTagX is committed to compliance with the General Data Protection Regulation (GDPR) for our users in the European Economic Area (EEA) and the United Kingdom.</p>
          
          <h2 className="text-2xl font-bold text-white mt-8 mb-4">1. Data Processing Roles</h2>
          <p>Under the GDPR, ClaimTagX acts as a Data Processor for the service data you input into our platform (e.g., patron details, photos). You, the customer, act as the Data Controller.</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">2. Data Subject Rights</h2>
          <p>We provide tools within our platform to help you respond to Data Subject Requests, including the right to access, rectify, or erase personal data.</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">3. Data Transfers</h2>
          <p>If personal data is transferred outside the EEA, we ensure appropriate safeguards are in place, such as Standard Contractual Clauses (SCCs).</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">4. Contact Our DPO</h2>
          <p>For GDPR-related inquiries, please contact our Data Protection Officer at <a href="mailto:dpo@claimtagx.com" className="text-lime hover:underline">dpo@claimtagx.com</a>.</p>
        </div>
      </div>
    </>
  );
}
