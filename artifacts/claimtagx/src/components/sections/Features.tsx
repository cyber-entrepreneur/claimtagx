import { motion } from 'framer-motion';
import { ShieldCheck, Database, Smartphone, LayoutDashboard, Globe, Camera, WifiOff, FileText, Zap, type LucideIcon } from 'lucide-react';
import featureHero from '@/assets/feature-hero.png';
import { useI18n } from '@/lib/i18n';

const featureKeys: Array<{
  key: 'tamper' | 'isolation' | 'mobile' | 'visibility' | 'noApp' | 'photo' | 'offline' | 'audit' | 'setup';
  icon: LucideIcon;
}> = [
  { key: 'tamper', icon: ShieldCheck },
  { key: 'isolation', icon: Database },
  { key: 'mobile', icon: Smartphone },
  { key: 'visibility', icon: LayoutDashboard },
  { key: 'noApp', icon: Globe },
  { key: 'photo', icon: Camera },
  { key: 'offline', icon: WifiOff },
  { key: 'audit', icon: FileText },
  { key: 'setup', icon: Zap },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } }
};

export default function Features() {
  const { t } = useI18n();

  return (
    <section id="features" className="py-24 md:py-32 bg-obsidian border-t border-white/5 relative overflow-hidden">
      <div className="absolute top-0 end-0 w-[800px] h-[800px] bg-[radial-gradient(circle_at_top_right,_rgba(198,242,78,0.05),_transparent_70%)] pointer-events-none" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={containerVariants}
          className="flex flex-col items-center text-center mb-16"
        >
          <motion.div variants={itemVariants} className="mb-6">
            <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm">
              {t('home.features.eyebrow')}
            </span>
          </motion.div>

          <motion.h2 variants={itemVariants} className="text-3xl md:text-5xl font-bold text-white mb-6">
            {t('home.features.title')}
          </motion.h2>

          <motion.p variants={itemVariants} className="text-lg text-ink max-w-2xl">
            {t('home.features.subtitle')}
          </motion.p>
        </motion.div>

        {/* Hero Visual for Features */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
          className="w-full relative mb-24 rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl group"
        >
          <img
            src={featureHero}
            alt={t('home.features.heroAlt')}
            loading="lazy"
            decoding="async"
            className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-1000"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-obsidian via-transparent to-transparent pointer-events-none" />
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={containerVariants}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {featureKeys.map(({ key, icon: Icon }) => (
            <motion.div 
              key={key}
              variants={itemVariants}
              whileHover={{ y: -5 }}
              className="bg-steel border border-white/10 rounded-2xl p-8 hover:border-lime hover:bg-steel group shadow-lg overflow-hidden relative"
            >
              <div className="absolute top-0 end-0 w-32 h-32 bg-lime/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 rtl:-translate-x-1/2 group-hover:bg-lime/10 transition-colors duration-500" />
              
              <div className="relative z-10">
                <div className="w-14 h-14 bg-obsidian rounded-2xl flex items-center justify-center mb-6 border border-white/10 group-hover:border-lime/30 group-hover:scale-110 transition-all duration-300 shadow-inner">
                  <Icon className="w-6 h-6 text-lime" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{t(`home.features.items.${key}.title`)}</h3>
                <p className="text-ink leading-relaxed">
                  {t(`home.features.items.${key}.description`)}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
