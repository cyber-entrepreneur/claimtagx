import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { useI18n } from '@/lib/i18n';

function Counter({ from, to, duration = 2, suffix = '' }: { from: number; to: number; duration?: number; suffix?: string }) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(nodeRef, { once: true, margin: "-50px" });
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (!inView) return;

    let startTime: number | null = null;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
      
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(Math.floor(from + (to - from) * easeProgress));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [inView, from, to, duration]);

  return <span ref={nodeRef}>{value.toLocaleString()}{suffix}</span>;
}

export default function Stats() {
  const { t } = useI18n();

  return (
    <section className="py-20 bg-steel relative overflow-hidden border-y border-white/5">
      <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />
      <div className="absolute top-0 start-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-lime/30 to-transparent" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex flex-col items-center text-center"
          >
            <div className="text-4xl md:text-5xl font-extrabold text-white mb-2 font-mono">
              &lt;<Counter from={0} to={2} duration={2.5} suffix="s" />
            </div>
            <div className="text-sm text-lime font-medium uppercase tracking-wider">{t('home.stats.issueTicket')}</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="flex flex-col items-center text-center"
          >
            <div className="text-4xl md:text-5xl font-extrabold text-white mb-2 font-mono">
              $<Counter from={100} to={0} duration={2} />
            </div>
            <div className="text-sm text-lime font-medium uppercase tracking-wider">{t('home.stats.hardware')}</div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="flex flex-col items-center text-center"
          >
            <div className="text-4xl md:text-5xl font-extrabold text-white mb-2 font-mono">
              <Counter from={0} to={60} duration={2.5} suffix="s" />
            </div>
            <div className="text-sm text-lime font-medium uppercase tracking-wider">{t('home.stats.setup')}</div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="flex flex-col items-center text-center"
          >
            <div className="text-4xl md:text-5xl font-extrabold text-white mb-2 font-mono">
              <Counter from={90} to={99} duration={2} suffix=".9%" />
            </div>
            <div className="text-sm text-lime font-medium uppercase tracking-wider">{t('home.stats.uptime')}</div>
          </motion.div>

        </div>
      </div>
    </section>
  );
}
