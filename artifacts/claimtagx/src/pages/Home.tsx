import SEO from '@/components/SEO';
import Hero from '@/components/sections/Hero';
import TrustStrip from '@/components/sections/TrustStrip';
import Problem from '@/components/sections/Problem';
import ProductDemo from '@/components/sections/ProductDemo';
import OmniChannel from '@/components/sections/OmniChannel';
import Features from '@/components/sections/Features';
import Stats from '@/components/sections/Stats';
import Industries from '@/components/sections/Industries';
import ROICalculator from '@/components/sections/ROICalculator';
import PricePerTicket from '@/components/sections/PricePerTicket';
import Comparison from '@/components/sections/Comparison';
import PricingTeaser from '@/components/sections/PricingTeaser';
import FAQ from '@/components/sections/FAQ';
import FinalCTA from '@/components/sections/FinalCTA';
import StickyCTA from '@/components/StickyCTA';
import ContactFab from '@/components/ContactFab';
import { useI18n } from '@/lib/i18n';

export default function Home() {
  const { t } = useI18n();
  return (
    <>
      <SEO
        title={t('home.seo.title')}
        description={t('home.seo.description')}
        path="/"
      />
      <div className="bg-obsidian w-full relative overflow-hidden">
        {/* Subtle global noise/texture */}
        <div className="fixed inset-0 z-0 opacity-[0.02] pointer-events-none mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}></div>

        <Hero />
        <TrustStrip />
        <Problem />
        <PricePerTicket />
        <ProductDemo />
        <OmniChannel />
        <Features />
        <Stats />
        <Industries />
        <ROICalculator />
        <Comparison />
        <PricingTeaser />
        <FAQ />
        <FinalCTA />
        <StickyCTA />
        <ContactFab />
      </div>
    </>
  );
}
