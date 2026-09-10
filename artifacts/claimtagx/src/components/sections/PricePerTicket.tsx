import { motion } from 'framer-motion';
import { Camera, Check, Clock, FileText, Smartphone, X, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const paperKeys = ['number', 'lose', 'forge', 'noRecord', 'extras'] as const;
const digitalKeys: Array<{ key: 'photo' | 'chain' | 'phone' | 'audit'; icon: LucideIcon }> = [
  { key: 'photo', icon: Camera },
  { key: 'chain', icon: Clock },
  { key: 'phone', icon: Smartphone },
  { key: 'audit', icon: FileText },
];

export default function PricePerTicket() {
  const { t } = useI18n();

  return (
    <section id="price-per-ticket" className="py-24 md:py-32 bg-obsidian border-t border-white/5 relative overflow-hidden">
      <div className="absolute bottom-0 start-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[radial-gradient(ellipse_at_bottom,_rgba(198,242,78,0.05),_transparent_70%)] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center text-center mb-16"
        >
          <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm mb-6">
            {t('home.pricePerTicket.eyebrow')}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
            {t('home.pricePerTicket.title')}
            <span className="block text-ink mt-2">{t('home.pricePerTicket.titleAccent')}</span>
          </h2>
          <p className="text-lg text-ink max-w-2xl">
            {t('home.pricePerTicket.subtitle')}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto items-stretch">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="bg-steel border border-white/10 border-dashed rounded-3xl p-8 md:p-10 flex flex-col relative text-start"
          >
            <div className="flex items-baseline justify-between mb-6">
              <h3 className="font-mono text-sm font-bold text-ink uppercase tracking-[0.2em]">{t('home.pricePerTicket.paperTitle')}</h3>
              <div className="font-mono text-4xl font-extrabold text-ink">{t('home.pricePerTicket.paperPrice')}</div>
            </div>
            <p className="text-ink text-sm mb-6">{t('home.pricePerTicket.paperBuys')}</p>
            <ul className="flex flex-col gap-4 flex-1">
              {paperKeys.map((key) => (
                <li key={key} className="flex items-center gap-3 text-ink">
                  <X className="w-4 h-4 text-ink flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm">{t(`home.pricePerTicket.paper.${key}`)}</span>
                </li>
              ))}
            </ul>
            <p className="font-mono text-xs text-ink mt-8">
              {t('home.pricePerTicket.paperWrong')}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="bg-steel border border-lime/30 rounded-3xl p-8 md:p-10 flex flex-col relative shadow-[0_0_40px_rgba(198,242,78,0.08)] text-start"
          >
            <div className="absolute -top-3 start-8 bg-lime text-obsidian text-xs font-bold font-mono tracking-wider px-3 py-1 rounded-full">
              {t('home.pricePerTicket.badge')}
            </div>
            <div className="flex items-baseline justify-between mb-6">
              <h3 className="font-mono text-sm font-bold text-lime uppercase tracking-[0.2em]">{t('home.pricePerTicket.digitalTitle')}</h3>
              <div className="font-mono text-4xl font-extrabold text-white">{t('home.pricePerTicket.digitalPrice')}<span className="text-base text-ink align-top">*</span></div>
            </div>
            <p className="text-ink text-sm mb-6">{t('home.pricePerTicket.digitalBuys')}</p>
            <ul className="flex flex-col gap-4 flex-1">
              {digitalKeys.map(({ key, icon: Icon }) => (
                <li key={key} className="flex items-center gap-3 text-white">
                  <span className="text-lime flex-shrink-0"><Icon className="w-4 h-4" /></span>
                  <span className="text-sm">{t(`home.pricePerTicket.digital.${key}`)}</span>
                </li>
              ))}
            </ul>
            <p className="font-mono text-xs text-ink mt-8 flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-lime flex-shrink-0 mt-0.5" />
              {t('home.pricePerTicket.digitalWrong')}
            </p>
          </motion.div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center text-xs text-ink mt-8 max-w-xl mx-auto"
        >
          {t('home.pricePerTicket.footnote')}
        </motion.p>
      </div>
    </section>
  );
}
