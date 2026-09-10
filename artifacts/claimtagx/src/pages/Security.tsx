import { motion } from 'framer-motion';
import { Link } from 'wouter';
import {
  ArrowRight,
  Database,
  FileCheck,
  FileText,
  Globe2,
  KeyRound,
  Lock,
  Server,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import SEO from '@/components/SEO';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
};

const PILLAR_KEYS = [
  { key: 'tamper', icon: KeyRound },
  { key: 'isolation', icon: Database },
  { key: 'audit', icon: FileCheck },
  { key: 'encryption', icon: Lock },
  { key: 'infra', icon: Server },
  { key: 'privacy', icon: Globe2 },
] as const satisfies ReadonlyArray<{ key: string; icon: LucideIcon }>;

const CERT_KEYS = [
  { key: 'soc2', labelKey: 'roadmap' },
  { key: 'iso27001', labelKey: 'roadmap' },
  { key: 'customDpa', labelKey: 'availableNow' },
] as const;

const LEGAL_LINKS = [
  { href: '/privacy', key: 'privacy' },
  { href: '/terms', key: 'terms' },
  { href: '/gdpr', key: 'gdpr' },
  { href: '/dpa', key: 'dpa' },
  { href: '/cookies', key: 'cookies' },
  { href: '/aup', key: 'aup' },
] as const;

export default function Security() {
  const { t, localizedPath } = useI18n();
  return (
    <>
      <SEO
        title={t('pages.securityTitle')}
        description={t('pages.securityDescription')}
        url="https://claimtagx.com/security"
      />
      <div className="bg-obsidian w-full relative overflow-hidden pt-28 md:pt-36 pb-20">
        {/* Hero */}
        <section className="relative bg-gradient-mesh pb-20">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={containerVariants}
              className="text-center"
            >
              <motion.div variants={itemVariants} className="mb-6">
                <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm">
                  {t('security.hero.eyebrow')}
                </span>
              </motion.div>
              <motion.h1
                variants={itemVariants}
                className="font-extrabold tracking-tight leading-[1.1] text-white mb-6"
                style={{ fontSize: 'clamp(36px, 5vw, 64px)' }}
              >
                {t('security.hero.titleBefore')}{' '}
                <span className="text-shimmer">{t('security.hero.titleHighlight')}</span>
              </motion.h1>
              <motion.p
                variants={itemVariants}
                className="text-lg md:text-xl text-ink max-w-2xl mx-auto leading-relaxed mb-10"
              >
                {t('security.hero.subtitle')}
              </motion.p>
              <motion.div variants={itemVariants} className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="mailto:sales@claimtagx.com?subject=Security%20documentation%20request"
                  onClick={() => track('cta_clicked', { action: 'request_security_docs', location: 'security_hero' })}
                  className="w-full sm:w-auto cta-lime px-7 py-3.5 rounded-lg font-bold"
                >
                  {t('security.hero.ctaDocs')}
                </a>
                <a
                  href="#pillars"
                  className="w-full sm:w-auto cta-steel border border-white/20 px-7 py-3.5 rounded-lg font-bold group flex items-center justify-center gap-2"
                >
                  {t('security.hero.ctaDetails')}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </a>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Pillars */}
        <section id="pillars" className="py-20 border-t border-white/5">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-100px' }}
              variants={containerVariants}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              {PILLAR_KEYS.map(({ key, icon: Icon }) => (
                <motion.div
                  key={key}
                  variants={itemVariants}
                  className="bg-steel border border-white/10 rounded-3xl p-7 md:p-8 hover:border-lime/30"
                >
                  <div className="w-12 h-12 bg-obsidian rounded-xl flex items-center justify-center mb-5 border border-white/10">
                    <Icon className="w-6 h-6 text-lime" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{t(`security.pillars.${key}.title`)}</h3>
                  <p className="text-ink leading-relaxed mb-4">{t(`security.pillars.${key}.plain`)}</p>
                  <p className="text-xs font-mono text-ink leading-relaxed border-t border-white/5 pt-3">
                    {t(`security.pillars.${key}.technical`)}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Certifications */}
        <section className="py-20 border-t border-white/5 bg-[#080B12]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.5 }}
              className="text-center mb-12"
            >
              <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm mb-6 inline-block">
                {t('security.certifications.eyebrow')}
              </span>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                {t('security.certifications.title')}
              </h2>
              <p className="text-ink max-w-2xl mx-auto">
                {t('security.certifications.subtitle')}
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {CERT_KEYS.map(({ key, labelKey }) => (
                <div
                  key={key}
                  className="bg-steel border border-white/10 rounded-2xl p-6"
                >
                  <span className="font-mono text-xs font-bold uppercase tracking-widest text-obsidian bg-lime border border-lime rounded-full px-2.5 py-1 inline-block mb-4">
                    {t(`security.certifications.${labelKey}`)}
                  </span>
                  <h3 className="text-lg font-bold text-white mb-2">{t(`security.certifications.${key}.title`)}</h3>
                  <p className="text-sm text-ink leading-relaxed">{t(`security.certifications.${key}.body`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Legal documents */}
        <section className="py-20 border-t border-white/5">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center text-center mb-12"
            >
              <FileText className="w-8 h-8 text-lime mb-4" />
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                {t('security.legalDocs.title')}
              </h2>
              <p className="text-ink max-w-2xl">
                {t('security.legalDocs.subtitle')}
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {LEGAL_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={localizedPath(l.href)}
                  className="bg-steel border border-white/10 rounded-2xl p-5 flex items-start justify-between gap-4 hover:border-lime hover:bg-steel group"
                >
                  <div>
                    <h3 className="text-white font-bold mb-1 group-hover:text-lime transition-colors">
                      {t(`security.legalDocs.${l.key}.label`)}
                    </h3>
                    <p className="text-sm text-ink leading-relaxed">{t(`security.legalDocs.${l.key}.desc`)}</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-ink group-hover:text-lime group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="py-20 border-t border-white/5 bg-[#080B12]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <ShieldCheck className="w-10 h-10 text-lime mx-auto mb-5" />
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              {t('security.cta.title')}
            </h2>
            <p className="text-ink text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
              {t('security.cta.body')}
            </p>
            <a
              href="mailto:sales@claimtagx.com?subject=Enterprise%20security%20review"
              onClick={() => track('cta_clicked', { action: 'talk_to_sales', location: 'security_enterprise_cta' })}
              className="inline-flex items-center gap-2 cta-lime px-8 py-4 rounded-xl font-bold"
            >
              {t('security.cta.button')}
              <ArrowRight className="w-5 h-5" />
            </a>
          </div>
        </section>
      </div>
    </>
  );
}
