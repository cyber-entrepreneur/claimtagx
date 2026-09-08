import SEO from '@/components/SEO';
import { useI18n } from '@/lib/i18n';
import { legalPageSeo } from '@/lib/seo/legalLocalization';

// Shell chrome is localized; legal body copy requires qualified human review before translation or publication as localized law.
export default function Cookies() {
  const { t, locale } = useI18n();
  return (
    <>
      <SEO
        {...legalPageSeo("/cookies", locale === "ar" ? "ar" : "en", {
          title: t("legal.cookies.seoTitle"),
          description: t("legal.cookies.seoDescription"),
        })}
      />
      <div className="pt-32 pb-20 max-w-[800px] mx-auto px-4 sm:px-6">
        <h1 className="text-4xl font-bold text-white mb-2">{t('legal.cookies.title')}</h1>
        <p className="text-ink text-sm mb-10 pb-10 border-b border-white/10">{t('legal.lastUpdatedLower', { date: 'April 17, 2026' })}</p>

        <div className="prose prose-invert prose-slate max-w-none text-ink-300">
          <p>This Cookie Policy explains how ClaimTagX uses cookies and similar technologies to recognize you when you visit our website and use our platform.</p>
          
          <h2 className="text-2xl font-bold text-white mt-8 mb-4">1. What are cookies?</h2>
          <p>Cookies are small data files that are placed on your computer or mobile device when you visit a website. Cookies are widely used to make websites work, or work more efficiently, as well as to provide reporting information.</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">2. How we use cookies</h2>
          <p>We use essential cookies to enable you to navigate the platform and use its features, such as accessing secure areas. We also use analytics cookies to understand how our platform is being used to improve performance.</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">3. Managing cookies</h2>
          <p>You have the right to decide whether to accept or reject cookies. You can set or amend your web browser controls to accept or refuse cookies. If you choose to reject cookies, you may still use our website though your access to some functionality and areas may be restricted.</p>

          <h2 className="text-2xl font-bold text-white mt-8 mb-4">4. Contact Us</h2>
          <p>If you have any questions about our use of cookies, please contact us at <a href="mailto:privacy@claimtagx.com" className="text-lime hover:underline">privacy@claimtagx.com</a>.</p>
        </div>
      </div>
    </>
  );
}
