import { useEffect } from 'react';
import { useParams, Link } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import SEO from '@/components/SEO';
import NotFound from '@/pages/not-found';
import ROICalculator from '@/components/sections/ROICalculator';
import PricePerTicket from '@/components/sections/PricePerTicket';
import FinalCTA from '@/components/sections/FinalCTA';
import StickyCTA from '@/components/StickyCTA';
import { getSolution, solutions } from '@/lib/solutions';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' as const } },
};

export default function SolutionPage() {
  const { t, dir, localizedPath } = useI18n();
  const params = useParams<{ slug: string }>();
  const solution = getSolution(params.slug ?? '');
  const slug = solution?.slug ?? '';
  const sk = (key: string) => `solutions.${slug}.${key}`;
  const name = solution ? t(sk('name')) : '';

  // BreadcrumbList structured data for rich search results
  useEffect(() => {
    if (!solution) return;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('solutions.chrome.breadcrumbHome'), item: 'https://claimtagx.com/' },
        { '@type': 'ListItem', position: 2, name: t('solutions.chrome.breadcrumbSolutions'), item: 'https://claimtagx.com/#industries' },
        { '@type': 'ListItem', position: 3, name: t(sk('name')), item: `https://claimtagx.com/solutions/${solution.slug}` },
      ],
    });
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, [solution, t, slug]);

  if (!solution) {
    return <NotFound />;
  }

  const primaryCtaUrl = solution.primaryCta?.url ?? 'https://app.claimtagx.com/signup';
  const isMailto = primaryCtaUrl.startsWith('mailto:');
  const primaryCtaLabel = solution.primaryCta
    ? t(sk('primaryCtaLabel'))
    : t('home.hero.startFree');

  return (
    <>
      <SEO
        title={t(sk('seoTitle'))}
        description={t(sk('seoDescription'))}
        url={`https://claimtagx.com/solutions/${solution.slug}`}
      />
      <div className="bg-obsidian w-full relative overflow-hidden">
        {/* Hero */}
        <section className="relative pt-32 pb-20 md:pt-44 md:pb-28 overflow-hidden bg-gradient-mesh">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div className="flex flex-col items-start text-left">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="mb-6"
                >
                  <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm">
                    {t('solutions.chrome.forBrand', { name })}
                  </span>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                  className="font-extrabold tracking-tight leading-[1.1] mb-6"
                  style={{ fontSize: 'clamp(36px, 4.5vw, 58px)' }}
                >
                  <span className="block text-white">{t(sk('headline0'))}</span>
                  <span className="block text-shimmer">{t(sk('headline1'))}</span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className="text-lg md:text-xl text-ink mb-10 leading-relaxed max-w-lg"
                >
                  {t(sk('subhead'))}
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                  className="flex flex-col sm:flex-row items-center gap-4 mb-5 w-full sm:w-auto"
                >
                  <a
                    href={primaryCtaUrl}
                    target={isMailto ? undefined : '_blank'}
                    rel={isMailto ? undefined : 'noopener noreferrer'}
                    onClick={() =>
                      track('cta_clicked', {
                        action: isMailto ? 'talk_to_sales' : 'start_free',
                        location: 'solution_page',
                        vertical: solution.slug,
                      })
                    }
                    className="w-full sm:w-auto bg-lime text-obsidian px-8 py-4 rounded-lg font-bold text-lg hover:bg-lime-hover hover:-translate-y-px hover:shadow-[0_0_30px_rgba(198,242,78,0.4)] transition-all duration-200 text-center"
                  >
                    {primaryCtaLabel}
                  </a>
                  <a
                    href="https://calendly.com/claimtagx/demo"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      track('cta_clicked', { action: 'book_demo', location: 'solution_page', vertical: solution.slug })
                    }
                    className="w-full sm:w-auto border border-white/15 text-white px-8 py-4 rounded-lg font-bold text-lg hover:border-lime/40 hover:text-lime transition-all duration-200 group flex items-center justify-center gap-2"
                  >
                    {t('home.hero.bookDemo')}
                    <ArrowRight className={`w-5 h-5 group-hover:translate-x-1 transition-transform ${dir === 'rtl' ? 'rotate-180' : ''}`} />
                  </a>
                </motion.div>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.4 }}
                  className="text-sm text-ink/80 mb-6"
                >
                  {t('home.hero.riskReversal')}
                </motion.p>

                {/* Channels for this vertical */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.5 }}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {solution.channels.map((ch) => (
                      <span
                        key={ch}
                        className="text-xs font-mono font-semibold text-white/70 bg-white/5 border border-white/10 rounded-full px-3 py-1.5"
                      >
                        {t(`solutions.channels.${ch}`)}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-ink/70">{t(sk('channelNote'))}</p>
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.7, delay: 0.2 }}
                className="relative rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl"
              >
                <img
                  src={solution.image}
                  alt={t('solutions.chrome.imageAlt', { name })}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-obsidian/70 via-transparent to-transparent pointer-events-none" />
              </motion.div>
            </div>
          </div>
        </section>

        {/* Pain points */}
        <section className="py-24 md:py-32 bg-[#080B12] border-t border-white/5 relative overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-100px' }}
              variants={containerVariants}
              className="flex flex-col items-center text-center mb-16"
            >
              <motion.div variants={itemVariants} className="mb-6">
                <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm">
                  {t('solutions.chrome.problemEyebrow')}
                </span>
              </motion.div>
              <motion.h2 variants={itemVariants} className="text-3xl md:text-5xl font-bold text-white mb-4">
                {t('solutions.chrome.problemTitle', { audienceLead: t(sk('audienceLead')) })}
              </motion.h2>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-100px' }}
              variants={containerVariants}
              className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              {solution.painIcons.map((icon, i) => (
                <motion.div
                  key={i}
                  variants={itemVariants}
                  whileHover={{ y: -5 }}
                  className="bg-steel/80 backdrop-blur-sm border border-white/5 rounded-2xl p-8 hover:border-lime/30 transition-all duration-300 group shadow-lg"
                >
                  <div className="w-12 h-12 bg-obsidian rounded-xl flex items-center justify-center mb-5 border border-white/5 group-hover:bg-lime/10 transition-colors duration-300">
                    {icon}
                  </div>
                  <h3 className="text-lg font-bold text-white mb-3">{t(sk(`pains.${i}.title`))}</h3>
                  <p className="text-sm text-ink leading-relaxed">{t(sk(`pains.${i}.description`))}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* How it works (vertical-specific) */}
        <section className="py-24 md:py-32 bg-obsidian border-t border-white/5 relative overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-100px' }}
              variants={containerVariants}
              className="flex flex-col items-center text-center mb-16"
            >
              <motion.div variants={itemVariants} className="mb-6">
                <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm">
                  {t('solutions.chrome.howEyebrow')}
                </span>
              </motion.div>
              <motion.h2 variants={itemVariants} className="text-3xl md:text-5xl font-bold text-white">
                {t('solutions.chrome.howTitle')}
              </motion.h2>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-100px' }}
              variants={containerVariants}
              className="grid grid-cols-1 md:grid-cols-3 gap-8"
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  variants={itemVariants}
                  className="bg-steel/60 border border-white/5 rounded-3xl p-8 hover:border-lime/30 transition-all duration-500 hover:-translate-y-1"
                >
                  <div className="w-10 h-10 rounded-full bg-lime text-obsidian flex items-center justify-center font-mono text-sm font-bold shadow-[0_0_15px_rgba(198,242,78,0.4)] mb-5">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{t(sk(`steps.${i}.title`))}</h3>
                  <p className="text-ink leading-relaxed">{t(sk(`steps.${i}.description`))}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Price parity */}
        <PricePerTicket />

        {/* ROI with vertical defaults */}
        <ROICalculator
          defaultItemsPerDay={solution.roi.itemsPerDay}
          defaultDaysPerWeek={solution.roi.daysPerWeek}
          itemLabel={t(sk('roiItemLabel'))}
        />

        {/* Vertical FAQ */}
        <section className="py-24 bg-[#080B12] border-t border-white/5">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center text-center mb-12"
            >
              <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm mb-6">
                {t('solutions.chrome.faqEyebrow')}
              </span>
              <h2 className="text-3xl md:text-4xl font-bold text-white">
                {t('solutions.chrome.faqTitle', { name })}
              </h2>
            </motion.div>

            <div className="flex flex-col gap-6">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-50px' }}
                  transition={{ duration: 0.5 }}
                  className="bg-steel/40 border border-white/10 rounded-2xl p-6"
                >
                  <h3 className="text-white font-semibold mb-2">{t(sk(`faqs.${i}.q`))}</h3>
                  <p className="text-ink leading-relaxed text-sm">{t(sk(`faqs.${i}.a`))}</p>
                </motion.div>
              ))}
            </div>

            {/* Cross-links to other verticals */}
            <div className="mt-12 pt-8 border-t border-white/5 text-center">
              <p className="text-sm text-ink mb-4">{t('solutions.chrome.alsoWorksFor')}</p>
              <div className="flex flex-wrap justify-center gap-3">
                {solutions
                  .filter((s) => s.slug !== solution.slug)
                  .map((s) => (
                    <Link
                      key={s.slug}
                      href={localizedPath(`/solutions/${s.slug}`)}
                      className="text-sm font-medium text-white/70 bg-white/5 border border-white/10 rounded-full px-4 py-2 hover:border-lime/40 hover:text-lime transition-all"
                    >
                      {t(`solutions.${s.slug}.name`)}
                    </Link>
                  ))}
              </div>
            </div>
          </div>
        </section>

        <FinalCTA />
        <StickyCTA />
      </div>
    </>
  );
}
