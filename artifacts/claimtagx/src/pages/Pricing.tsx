import SEO from '@/components/SEO';
import PricingSection from '@/components/sections/Pricing';
import FinalCTA from '@/components/sections/FinalCTA';
import { useI18n } from '@/lib/i18n';

export default function PricingPage() {
  const { t } = useI18n();
  return (
    <>
      <SEO
        title={t('pages.pricingTitle')}
        description={t('pages.pricingDescription')}
        path="/price"
      />
      <div className="bg-obsidian w-full relative overflow-hidden pt-16">
        <PricingSection />
        <FinalCTA />
      </div>
    </>
  );
}
