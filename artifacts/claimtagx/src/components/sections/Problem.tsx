import { motion } from 'framer-motion';
import { EyeOff, ClipboardList, Clock, DollarSign, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const painKeys: Array<{ key: 'blind' | 'lastImpression' | 'tax' | 'visibility'; icon: LucideIcon }> = [
  { key: 'blind', icon: EyeOff },
  { key: 'lastImpression', icon: Clock },
  { key: 'tax', icon: DollarSign },
  { key: 'visibility', icon: ClipboardList },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' as const } },
};

export default function Problem() {
  const { t } = useI18n();

  return (
    <section id="problem" className="py-24 md:py-32 bg-obsidian border-t border-white/5 relative overflow-hidden">
      <div className="absolute top-0 end-0 w-full h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-lime/[0.02] via-obsidian to-obsidian pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={containerVariants}
          className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center"
        >
          <div className="flex flex-col justify-center">
            <motion.div variants={itemVariants} className="mb-6">
              <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm">
                {t('home.problem.eyebrow')}
              </span>
            </motion.div>

            <motion.h2 variants={itemVariants} className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight">
              {t('home.problem.title')}
              <span className="block text-ink font-bold mt-2">{t('home.problem.titleAccent')}</span>
            </motion.h2>

            <motion.p variants={itemVariants} className="text-lg text-ink leading-relaxed">
              {t('home.problem.body1')}
            </motion.p>
            <motion.p variants={itemVariants} className="text-lg text-ink leading-relaxed mt-4">
              {t('home.problem.body2')}
            </motion.p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 relative">
            <div className="absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-lime/5 blur-[80px] rounded-full pointer-events-none" />
            {painKeys.map(({ key, icon: Icon }) => (
              <motion.div
                key={key}
                variants={itemVariants}
                whileHover={{ y: -5, scale: 1.02 }}
                className="bg-steel/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6 hover:border-lime/30 transition-all duration-300 group shadow-lg"
              >
                <div className="w-12 h-12 bg-obsidian rounded-xl flex items-center justify-center mb-4 border border-white/5 group-hover:bg-lime/10 transition-colors duration-300 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-lime/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <span className="relative z-10">
                    <Icon className="w-6 h-6 text-lime" />
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{t(`home.problem.${key}Title`)}</h3>
                <p className="text-sm text-ink leading-relaxed group-hover:text-ink/80 transition-colors">
                  {t(`home.problem.${key}Body`)}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
