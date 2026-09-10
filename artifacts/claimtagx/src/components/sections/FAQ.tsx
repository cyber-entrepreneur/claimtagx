import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useI18n } from '@/lib/i18n';

const FAQ_ITEM_KEYS = ['app', 'offline', 'setup', 'lostTicket', 'forge', 'disputes', 'cost'] as const;

export default function FAQ() {
  const { t, locale } = useI18n();
  const faqs = useMemo(
    () =>
      FAQ_ITEM_KEYS.map((key) => ({
        q: t(`home.faq.items.${key}.q`),
        a: t(`home.faq.items.${key}.a`),
      })),
    [t, locale],
  );

  // Inject FAQPage structured data for search engines
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: locale === 'ar' ? 'ar' : 'en',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, [faqs, locale]);

  return (
    <section id="faq" className="py-24 md:py-32 bg-obsidian border-t border-white/5 relative overflow-hidden">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center text-center mb-12"
        >
          <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 px-3 py-1 rounded-sm mb-6">
            {t('home.faq.eyebrow')}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
            {t('home.faq.title')}
          </h2>
          <p className="text-lg text-ink">
            {t('home.faq.subtitlePrefix')}{' '}
            <a href="mailto:sales@claimtagx.com" className="text-lime hover:text-lime-hover transition-colors font-medium">
              {t('home.faq.talkToSales')}
            </a>{' '}
            {t('home.faq.humanAnswers')}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <Accordion type="single" collapsible className="flex flex-col gap-3">
            {faqs.map((faq, i) => (
              <AccordionItem
                key={FAQ_ITEM_KEYS[i]}
                value={`faq-${i}`}
                className="bg-steel border border-white/10 rounded-2xl px-6 data-[state=open]:border-lime"
              >
                <AccordionTrigger className="text-start text-white font-semibold hover:no-underline hover:text-lime transition-colors py-5">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-ink leading-relaxed pb-5">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}
