import { useI18n } from '@/lib/i18n';

const itemKeys = [
  'photoProof',
  'channels',
  'offline',
  'noApp',
  'audit',
  'setup',
  'hardware',
  'insurance',
] as const;

export default function TrustStrip() {
  const { t } = useI18n();
  const items = itemKeys.map((key) => t(`home.trust.items.${key}`));

  return (
    <div className="py-10 bg-obsidian border-t border-white/5 overflow-hidden flex flex-col items-center justify-center">
      <p className="text-sm text-ink mb-6 uppercase tracking-widest font-semibold">
        {t('home.trust.headline')}
      </p>

      <div className="w-full relative flex overflow-x-hidden group">
        <div className="absolute top-0 start-0 w-32 h-full bg-gradient-to-r rtl:bg-gradient-to-l from-obsidian to-transparent z-10 pointer-events-none" />
        <div className="absolute top-0 end-0 w-32 h-full bg-gradient-to-l rtl:bg-gradient-to-r from-obsidian to-transparent z-10 pointer-events-none" />

        <div className="flex animate-marquee whitespace-nowrap">
          {/* Double the items for seamless loop */}
          {[...items, ...items].map((item, index) => (
            <div
              key={index}
              className="mx-8 text-xl font-bold text-white/55 hover:text-lime/80 transition-colors duration-300 select-none font-mono flex items-center gap-8"
            >
              {item}
              <span className="text-lime/30 text-sm">✦</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
