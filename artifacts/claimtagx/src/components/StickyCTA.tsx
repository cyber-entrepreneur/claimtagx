import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

export default function StickyCTA() {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const handleScroll = () => {
      // Appear after the hero is scrolled past
      setVisible(window.scrollY > window.innerHeight * 0.9);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-obsidian/95 backdrop-blur-md border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-3"
        >
          <div className="flex-1 min-w-0 text-start">
            <p className="text-white text-sm font-bold truncate">{t('home.stickyCta.title')}</p>
            <p className="text-ink text-xs truncate">{t('home.stickyCta.subtitle')}</p>
          </div>
          <a
            href="https://app.claimtagx.com/signup"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('cta_clicked', { action: 'start_free', location: 'sticky_mobile' })}
            className="bg-lime text-obsidian px-5 py-3 rounded-lg font-bold text-sm whitespace-nowrap"
          >
            {t('home.stickyCta.startFree')}
          </a>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
