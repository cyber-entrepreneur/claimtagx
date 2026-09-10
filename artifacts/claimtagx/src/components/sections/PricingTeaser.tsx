import { motion } from 'framer-motion';
import { Link } from 'wouter';
import { ArrowRight, Check } from 'lucide-react';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

export default function PricingTeaser() {
  const { t, dir, localizedPath } = useI18n();

  const tiers = [
    {
      key: 'free' as const,
      price: '$0',
      ctaKey: 'startFree' as const,
      url: 'https://app.claimtagx.com/signup',
    },
    {
      key: 'essential' as const,
      price: '$50',
      ctaKey: 'startFree' as const,
      url: 'https://app.claimtagx.com/signup',
      featured: true,
    },
    {
      key: 'enterprise' as const,
      price: t('home.pricingTeaser.tiers.enterprise.price'),
      ctaKey: 'talkToSales' as const,
      url: 'mailto:sales@claimtagx.com',
    },
  ];

  return (
    <section id="pricing" className="py-24 md:py-32 bg-[#080B12] border-t border-white/5 relative overflow-hidden">
      <div className="absolute top-0 end-0 w-[700px] h-[700px] bg-[radial-gradient(circle_at_top_right,_rgba(198,242,78,0.04),_transparent_70%)] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center text-center mb-16"
        >
          <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm mb-6">
            {t('home.pricingTeaser.eyebrow')}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
            {t('home.pricingTeaser.title')}
          </h2>
          <p className="text-lg text-ink max-w-2xl">
            {t('home.pricingTeaser.subtitle')}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-12">
          {tiers.map((tier, index) => {
            const name = t(`home.pricingTeaser.tiers.${tier.key}.name`);
            const period = tier.key === 'enterprise' ? '' : t(`home.pricingTeaser.tiers.${tier.key}.period`);
            return (
              <motion.div
                key={tier.key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className={`rounded-3xl p-8 flex flex-col border transition-all duration-300 relative text-start ${
                  tier.featured
                    ? 'bg-steel border-lime/40 shadow-[0_0_40px_rgba(198,242,78,0.1)] md:-translate-y-3'
                    : 'bg-steel border-white/10 hover:border-white/20'
                }`}
              >
                {tier.featured && (
                  <span className="absolute -top-3 start-1/2 -translate-x-1/2 bg-lime text-obsidian text-xs font-bold font-mono tracking-wider px-3 py-1 rounded-full">
                    {t('home.pricingTeaser.mostPopular')}
                  </span>
                )}
                <h3 className="text-lg font-bold text-white mb-2 font-mono uppercase tracking-wider">{name}</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-extrabold text-white font-mono">{tier.price}</span>
                  {period ? <span className="text-sm text-ink">{period}</span> : null}
                </div>
                <p className={`text-xs font-mono font-semibold mb-3 ${tier.featured ? 'text-lime' : 'text-ink'}`}>
                  {t(`home.pricingTeaser.tiers.${tier.key}.perTicket`)}
                </p>
                <p className="text-sm text-ink leading-relaxed mb-6">{t(`home.pricingTeaser.tiers.${tier.key}.description`)}</p>
                <ul className="flex flex-col gap-3 mb-8 flex-1">
                  {(['h1', 'h2', 'h3'] as const).map((h) => (
                    <li key={h} className="flex items-start gap-2 text-sm text-white">
                      <Check className="w-4 h-4 text-lime mt-0.5 flex-shrink-0" />
                      {t(`home.pricingTeaser.tiers.${tier.key}.${h}`)}
                    </li>
                  ))}
                </ul>
                <a
                  href={tier.url}
                  target={tier.url.startsWith('mailto:') ? undefined : '_blank'}
                  rel={tier.url.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
                  onClick={() => track('cta_clicked', { action: tier.url.startsWith('mailto:') ? 'talk_to_sales' : 'start_free', location: 'pricing_teaser', plan: name })}
                  className={`text-center px-6 py-3.5 rounded-xl font-bold ${
                    tier.featured ? 'cta-lime' : 'cta-steel border border-white/20'
                  }`}
                >
                  {t(tier.ctaKey === 'talkToSales' ? 'home.cta.talkToSales' : 'home.cta.startFree')}
                </a>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center"
        >
          <Link
            href={localizedPath('/price')}
            onClick={() => track('cta_clicked', { action: 'see_full_pricing', location: 'pricing_teaser' })}
            className="inline-flex items-center gap-2 text-lime font-semibold hover:text-lime-hover transition-colors group"
          >
            {t('home.pricingTeaser.compareAll')}
            <ArrowRight className={`w-4 h-4 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform ${dir === 'rtl' ? 'rotate-180' : ''}`} />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
