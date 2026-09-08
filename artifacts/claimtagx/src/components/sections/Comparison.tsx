import { motion } from 'framer-motion';
import { Check, Minus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type Cell = boolean | 'partial' | string;

export default function Comparison() {
  const { t } = useI18n();

  const comparisonData: Array<{ feature: string; paper: Cell; legacy: Cell; us: Cell }> = [
    { feature: t('home.comparison.rows.crypto'), paper: false, legacy: false, us: true },
    { feature: t('home.comparison.rows.offline'), paper: true, legacy: 'partial', us: true },
    { feature: t('home.comparison.rows.photo'), paper: false, legacy: 'partial', us: true },
    { feature: t('home.comparison.rows.dashboard'), paper: false, legacy: 'partial', us: true },
    { feature: t('home.comparison.rows.patronApp'), paper: true, legacy: false, us: true },
    { feature: t('home.comparison.rows.multiTenant'), paper: false, legacy: false, us: true },
    { feature: t('home.comparison.rows.audit'), paper: false, legacy: 'partial', us: true },
    {
      feature: t('home.comparison.rows.setup.feature'),
      paper: t('home.comparison.rows.setup.paper'),
      legacy: t('home.comparison.rows.setup.legacy'),
      us: t('home.comparison.rows.setup.us'),
    },
    {
      feature: t('home.comparison.rows.price.feature'),
      paper: t('home.comparison.rows.price.paper'),
      legacy: t('home.comparison.rows.price.legacy'),
      us: t('home.comparison.rows.price.us'),
    },
  ];

  return (
    <section id="comparison" className="py-24 md:py-32 bg-steel border-y border-white/5 relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-pattern opacity-[0.15] pointer-events-none" />
      
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center text-center mb-16"
        >
          <div className="mb-6">
            <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm">
              {t('home.comparison.eyebrow')}
            </span>
          </div>
          
          <h2 className="text-3xl md:text-5xl font-bold text-white">
            {t('home.comparison.title')}
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7 }}
          className="w-full overflow-x-auto pb-6"
          tabIndex={0}
          role="region"
          aria-label={t('home.comparison.feature')}
        >
          <div className="min-w-[700px] bg-obsidian rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl relative">
            <div className="absolute top-0 end-0 w-[25%] h-full bg-lime/[0.03] pointer-events-none" />
            
            <div className="grid grid-cols-4 bg-steel border-b border-white/10 p-6 font-bold text-sm">
              <div className="text-white uppercase tracking-wider text-xs text-start">{t('home.comparison.feature')}</div>
              <div className="text-ink uppercase tracking-wider text-xs text-center">{t('home.comparison.paper')}</div>
              <div className="text-ink uppercase tracking-wider text-xs text-center">{t('home.comparison.legacy')}</div>
              <div className="text-lime uppercase tracking-wider text-xs text-center relative">
                {t('home.comparison.us')}
                <div className="absolute -top-6 start-1/2 -translate-x-1/2 w-full h-1 bg-lime shadow-[0_0_10px_rgba(198,242,78,0.5)]" />
              </div>
            </div>
            
            <div className="divide-y divide-white/5">
              {comparisonData.map((row, i) => (
                <motion.div 
                  key={i} 
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="grid grid-cols-4 p-5 items-center hover:bg-white/[0.02] transition-colors relative z-10"
                >
                  <div className="text-white font-medium ps-2 text-start">{row.feature}</div>
                  
                  <div className="text-center flex justify-center">
                    {typeof row.paper === 'boolean' ? (
                      row.paper ? <Check className="w-5 h-5 text-ink" aria-hidden="true" /> : <Minus className="w-5 h-5 text-ink" aria-hidden="true" />
                    ) : (
                      <span className="text-sm text-ink font-medium">{row.paper}</span>
                    )}
                  </div>
                  
                  <div className="text-center flex justify-center">
                    {typeof row.legacy === 'boolean' ? (
                      row.legacy ? <Check className="w-5 h-5 text-ink" aria-hidden="true" /> : <Minus className="w-5 h-5 text-ink" aria-hidden="true" />
                    ) : row.legacy === "partial" ? (
                      <span className="text-amber-400 font-bold text-lg leading-none">~</span>
                    ) : (
                      <span className="text-sm text-ink font-medium">{row.legacy}</span>
                    )}
                  </div>
                  
                  <div className="text-center flex justify-center">
                    {typeof row.us === 'boolean' ? (
                      row.us ? (
                        <div className="bg-lime/10 p-1.5 rounded-full">
                          <Check className="w-5 h-5 text-lime" />
                        </div>
                      ) : <Minus className="w-5 h-5 text-lime" aria-hidden="true" />
                    ) : (
                      <span className="text-sm text-lime font-bold">{row.us}</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
