import { Link, useLocation } from 'wouter';
import { MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { track } from '@/lib/analytics';

export default function ContactFab() {
  const [location] = useLocation();
  if (location === '/contact' || location.startsWith('/admin')) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.6 }}
      className="fixed z-40 right-4 md:right-6 bottom-24 md:bottom-6"
    >
      <Link
        href="/contact"
        onClick={() => track('cta_clicked', { action: 'talk_to_sales', location: 'floating_contact' })}
        className="flex items-center gap-2 rounded-full bg-lime text-obsidian pl-4 pr-5 py-3 shadow-[0_8px_32px_rgba(198,242,78,0.28)] hover:bg-lime-hover hover:-translate-y-0.5 transition-all font-semibold text-sm"
        aria-label="Contact Us"
      >
        <MessageSquare className="w-4 h-4" aria-hidden="true" />
        Contact Us
      </Link>
    </motion.div>
  );
}
