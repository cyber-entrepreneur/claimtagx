import { motion } from 'framer-motion';
import { Bell, Bluetooth, Mail, MessageCircle, MessageSquare, Nfc, QrCode, WifiOff, Smartphone, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const channelKeys: Array<{ key: 'qr' | 'nfc' | 'ble' | 'sms' | 'whatsapp' | 'email' | 'push'; icon: LucideIcon }> = [
  { key: 'qr', icon: QrCode },
  { key: 'nfc', icon: Nfc },
  { key: 'ble', icon: Bluetooth },
  { key: 'sms', icon: MessageSquare },
  { key: 'whatsapp', icon: MessageCircle },
  { key: 'email', icon: Mail },
  { key: 'push', icon: Bell },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' as const } },
};

export default function OmniChannel() {
  const { t } = useI18n();

  return (
    <section id="channels" className="py-24 md:py-32 bg-[#080B12] border-t border-white/5 relative overflow-hidden">
      <div className="absolute top-0 start-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-lime/20 to-transparent" />

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
              {t('home.omni.eyebrow')}
            </span>
          </motion.div>
          <motion.h2 variants={itemVariants} className="text-3xl md:text-5xl font-bold text-white mb-4">
            {t('home.omni.titleLine1')}
            <span className="block text-shimmer mt-2">{t('home.omni.titleLine2')}</span>
          </motion.h2>
          <motion.p variants={itemVariants} className="text-lg text-ink max-w-2xl">
            {t('home.omni.subtitle')}
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={containerVariants}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10"
        >
          <motion.div
            variants={itemVariants}
            className="bg-steel border border-white/10 rounded-3xl p-8 md:p-10 relative overflow-hidden group hover:border-lime text-start"
          >
            <div className="absolute -top-10 -end-10 w-40 h-40 bg-lime/5 rounded-full blur-3xl" />
            <div className="w-14 h-14 bg-obsidian rounded-2xl flex items-center justify-center mb-6 border border-white/10">
              <WifiOff className="w-6 h-6 text-lime" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-4">
              {t('home.omni.offlineTitle')}
            </h3>
            <p className="text-ink leading-relaxed mb-4">
              {t('home.omni.offlineBody1')}
            </p>
            <p className="text-white leading-relaxed font-medium">
              {t('home.omni.offlineBody2')}
            </p>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="bg-steel border border-white/10 rounded-3xl p-8 md:p-10 relative overflow-hidden group hover:border-lime text-start"
          >
            <div className="absolute -top-10 -end-10 w-40 h-40 bg-lime/5 rounded-full blur-3xl" />
            <div className="w-14 h-14 bg-obsidian rounded-2xl flex items-center justify-center mb-6 border border-white/10">
              <Smartphone className="w-6 h-6 text-lime" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-4">
              {t('home.omni.guestTitle')}
            </h3>
            <p className="text-ink leading-relaxed mb-4">
              {t('home.omni.guestBody1')}
            </p>
            <p className="text-white leading-relaxed font-medium">
              {t('home.omni.guestBody2')}
            </p>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="bg-obsidian border border-white/10 rounded-2xl p-6 md:p-8"
        >
          <p className="text-center text-sm text-ink mb-5 font-medium">
            {t('home.omni.channelIntro')}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {channelKeys.map(({ key, icon: Icon }) => (
              <span
                key={key}
                className="flex items-center gap-2 text-sm font-semibold text-white bg-steel border border-white/20 rounded-full px-4 py-2.5"
              >
                <span className="text-lime"><Icon className="w-4 h-4" /></span>
                {t(`home.omni.channels.${key}`)}
              </span>
            ))}
          </div>
          <p className="text-center text-xs text-ink mt-5">
            {t('home.omni.channelFootnote')}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
