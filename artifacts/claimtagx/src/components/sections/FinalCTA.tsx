import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

export default function FinalCTA() {
  const { t, dir } = useI18n();
  return (
    <section className="relative py-32 md:py-48 bg-obsidian overflow-hidden flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-mesh opacity-50" />
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.03, 0.06, 0.03],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-lime blur-[120px] rounded-full pointer-events-none"
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 w-full text-center border border-white/10 bg-steel rounded-[3rem] p-12 md:p-24 shadow-2xl">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7 }}
        >
          <h2 className="text-4xl md:text-6xl font-bold text-white mb-6 tracking-tight">
            {t('home.cta.titleLine1')}
            <span className="block text-shimmer mt-2">{t('home.cta.titleLine2')}</span>
          </h2>

          <p className="text-xl text-ink mb-12 max-w-2xl mx-auto leading-relaxed">
            {t('home.cta.body')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-8">
            <a
              href="https://app.claimtagx.com/signup"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('cta_clicked', { action: 'start_free', location: 'final_cta' })}
              className="w-full sm:w-auto cta-lime px-10 py-5 rounded-xl font-extrabold text-lg"
            >
              {t('home.cta.startFree')}
            </a>
            <a
              href="https://calendly.com/claimtagx/demo"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('cta_clicked', { action: 'book_demo', location: 'final_cta' })}
              className="w-full sm:w-auto cta-steel border border-white/20 px-10 py-5 rounded-xl font-bold text-lg group flex items-center justify-center gap-2"
            >
              {t('home.cta.bookDemo')}
              <ArrowRight className={`w-5 h-5 transition-transform group-hover:translate-x-1 ${dir === 'rtl' ? 'rotate-180' : ''}`} />
            </a>
          </div>

          <p className="text-sm text-ink font-medium">
            {t('home.cta.footnote')}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
