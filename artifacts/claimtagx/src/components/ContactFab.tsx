import { Link, useLocation } from 'wouter';
import { MessageSquare } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { track } from '@/lib/analytics';
import { stripLocalePrefix, useI18n } from '@/lib/i18n';

export default function ContactFab() {
  const [location] = useLocation();
  const { t, localizedPath } = useI18n();
  const reduceMotion = useReducedMotion();
  const path = stripLocalePrefix(location);
  if (path === '/contact' || path.startsWith('/admin')) return null;

  return (
    <motion.div
      data-testid="contact-fab"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.6 }}
      className="fixed z-40 end-4 md:end-6 bottom-24 md:bottom-6"
    >
      <Link
        href={localizedPath('/contact')}
        onClick={() => track('cta_clicked', { action: 'talk_to_sales', location: 'floating_contact' })}
        className="flex items-center gap-2 rounded-full bg-lime text-obsidian ps-4 pe-5 py-3 shadow-[0_8px_32px_rgba(198,242,78,0.28)] hover:bg-lime-hover hover:-translate-y-0.5 transition-all font-semibold text-sm"
        aria-label={t('home.contactFab.label')}
      >
        <MessageSquare className="w-4 h-4" aria-hidden="true" />
        {t('home.contactFab.label')}
      </Link>
    </motion.div>
  );
}
