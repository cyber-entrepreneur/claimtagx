import SEO from '@/components/SEO';
import { useI18n } from '@/lib/i18n';
import { legalPageSeo } from '@/lib/seo/legalLocalization';

// Shell chrome is localized; legal body copy requires qualified human review before translation or publication as localized law.
export default function Refund() {
  const { t, locale } = useI18n();
  return (
    <>
      <SEO
        {...legalPageSeo("/refund", locale === "ar" ? "ar" : "en", {
          title: t("legal.refund.seoTitle"),
          description: t("legal.refund.seoDescription"),
        })}
      />
      <div className="pt-32 pb-20 max-w-[800px] mx-auto px-4 sm:px-6">
        <h1 className="text-4xl font-bold text-white mb-2">{t('legal.refund.title')}</h1>
        <p className="text-ink text-sm mb-2">{t('legal.effectiveDate', { date: 'April 20, 2026' })}</p>
        <p className="text-ink text-sm mb-10 pb-10 border-b border-white/10">{t('legal.lastUpdated', { date: 'April 17, 2026' })}</p>

        <div className="prose prose-invert prose-slate max-w-none text-ink-300 space-y-4 leading-relaxed">
          <h2 className="text-2xl font-bold text-white mt-10 mb-4">1. Overview</h2>
          <p>This Refund Policy governs all purchases made through ClaimTagX ("Platform"), including subscription plans and any paid services offered by Tenants through the Platform.</p>
          <p>ClaimTagX operates as a digital custody management infrastructure platform. Refund eligibility is limited and subject to the conditions outlined below.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">2. General Principle</h2>
          <p>All purchases on ClaimTagX are considered final and non-refundable, unless explicitly stated otherwise in this policy or required by applicable law.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">3. Subscription Fees</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.1 Billing</h3>
          <p>Subscription plans (Starter, Pro, and Enterprise) are billed in advance on a recurring basis. Payments are processed by Paddle.com Market Limited ("Paddle"), our Merchant of Record.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.2 Refunds</h3>
          <p>Subscription fees are non-refundable once the billing cycle has started. No refunds are provided for partial usage, unused time, or downgrades during an active billing period.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.3 Free Trial</h3>
          <p>New Tenants may be eligible for a 14-day free trial. No payment is required to start a trial. If you do not select a paid plan before the trial ends, your account will be deactivated and data retained for 30 days before permanent deletion.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.4 Upgrades and Downgrades</h3>
          <p>Upgrades take effect immediately and may be prorated. Downgrades take effect at the start of the next billing cycle.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.5 Cancellation</h3>
          <p>Tenants may cancel their subscription at any time through the Paddle billing portal. Cancellation takes effect at the end of the current billing period. No partial refunds are issued for the remainder of a billing period.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">4. Paid Services (Tenant-Provided)</h2>
          <p>Tenants (operators) may offer physical services to their patrons through the Platform, such as valet parking, laundry, luggage handling, repair services, and other custody or hospitality services.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.1 Responsibility</h3>
          <p>ClaimTagX does not provide these services, does not control service delivery, and does not set pricing for Tenant-provided services. ClaimTagX is strictly a technology provider (see our <a href="/terms" className="text-lime hover:underline">Terms of Service</a>, Section 2).</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.2 Refund Handling</h3>
          <p>All refund requests related to Tenant-provided services must be directed to the Tenant (service provider). ClaimTagX is not responsible for service quality, service disputes, or refund decisions made by Tenants.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">5. Payment Errors and Duplicate Charges</h2>
          <p>Refunds may be issued in cases of duplicate charges, unauthorized transactions, or verified billing errors. All such cases are subject to review and validation by ClaimTagX and Paddle.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">6. Chargebacks</h2>
          <p>If a chargeback is initiated against a ClaimTagX subscription payment, ClaimTagX reserves the right to suspend or restrict the associated account, recover associated losses, and deny future transactions from the account holder.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">7. Fraud and Abuse</h2>
          <p>Refunds will not be issued in cases involving abuse of the Platform, fraudulent activity, or attempts to manipulate billing or refund eligibility.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">8. Refund Method</h2>
          <p>Where a refund is approved, it will be processed by Paddle and issued to the original payment method. Processing times depend on Paddle and the cardholder's financial institution — typically 5–10 business days.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">9. Regional Legal Rights</h2>
          <p>Nothing in this policy overrides any rights provided under applicable consumer protection laws in your jurisdiction. Where required by law, mandatory refund rights will apply regardless of the terms above.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">10. Changes to This Policy</h2>
          <p>ClaimTagX may update this Refund Policy from time to time. When we make material changes, we will notify Tenant administrators via email and/or in-platform notification. The "Last Updated" date at the top of this policy will be revised. Continued use of the Platform after the effective date of updated terms constitutes acceptance.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">11. Contact</h2>
          <p>For refund-related inquiries:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong className="text-white">Email:</strong> billing@claimtagx.com</li>
            <li><strong className="text-white">Website:</strong> https://claimtagx.com</li>
          </ul>
          <p>Subscription billing and refund processing is handled by Paddle. For payment-specific questions, you may also contact Paddle directly through your billing portal.</p>

          <p className="text-ink text-sm italic mt-10 pt-10 border-t border-white/10">ClaimTagX is operated by Ali Achkar (sole proprietor). This notice will be updated upon formal incorporation.</p>
          <p className="text-ink text-sm italic">© 2026 ClaimTagX. All rights reserved.</p>
        </div>
      </div>
    </>
  );
}
