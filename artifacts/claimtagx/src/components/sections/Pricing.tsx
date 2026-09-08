import { Fragment, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Minus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type Tier = 'free' | 'basic' | 'essential' | 'advanced' | 'enterprise';
type CellToken =
  | 'unlimited'
  | 'textOnly'
  | 'ootbTemplate'
  | 'configurableShared'
  | 'multiTemplate'
  | 'fullyCustomizable'
  | 'limited'
  | 'basic'
  | 'advanced'
  | 'full'
  | 'optional'
  | 'static'
  | 'dynamicOtp'
  | 'cloudOnly'
  | 'cloud'
  | 'cloudOnPrem'
  | 'oneOnly'
  | 'manual'
  | 'rotation'
  | 'fullSla'
  | 'basicLogOnly'
  | 'fullWorkflow'
  | 'flat'
  | 'tiered'
  | 'oneIncluded'
  | 'custom'
  | 'predictive'
  | 'partial';
type NumericCell = '1' | '5' | '15' | '25' | '250' | '1,000' | '2,000';
type Cell = boolean | CellToken | NumericCell;
type FeatureKey =
  | 'stations' | 'staff' | 'ticketsMonth' | 'ticketType' | 'fullLifecycle' | 'multiAsset' | 'workflow'
  | 'perStationConfig' | 'webLink' | 'emailDelivery' | 'qrClaim' | 'smsWhatsapp' | 'nfcBleTransfer'
  | 'inAppPush' | 'offlineIssuance' | 'manualEntry' | 'photoCapture' | 'aiCapture' | 'lookup'
  | 'staffAccounts' | 'shiftMgmt' | 'handlerAssign' | 'taskMgmt' | 'supervisor' | 'csrUnstructured'
  | 'csrStructured' | 'capacityTracking' | 'multiLayer' | 'crossStation' | 'staticQr' | 'dynamicQr'
  | 'pin' | 'otp' | 'nfcBle' | 'biometric' | 'validationRules' | 'validationLogs' | 'disputeMgmt'
  | 'notesText' | 'notesVoice' | 'auditLogs' | 'notifications' | 'patronMessaging' | 'internalMessaging'
  | 'intercom' | 'paidServices' | 'servicePricing' | 'ancillary' | 'invoice' | 'marketplaceBuy'
  | 'marketplaceSell' | 'ticketMarket' | 'freeTemplate' | 'aiSuggestions' | 'insights' | 'disputeAssist'
  | 'predictive' | 'logoBranding' | 'templateCustom' | 'perStationBrand' | 'whiteLabel' | 'apiAccess'
  | 'thirdParty' | 'deployment' | 'multiRegion';
type CategoryKey =
  | 'capacity' | 'core' | 'issuance' | 'input' | 'workforce' | 'custody' | 'validation'
  | 'control' | 'communication' | 'revenue' | 'marketplace' | 'ai' | 'branding' | 'integrations';
type NoteKey = 'sms' | 'ai';
type Row = { feature: FeatureKey; values: Record<Tier, Cell>; note?: NoteKey };
type Group = { category: CategoryKey; rows: Row[] };

const tierOrder: Tier[] = ['free', 'basic', 'essential', 'advanced', 'enterprise'];
const numericCells = new Set<string>(['1', '5', '15', '25', '250', '1,000', '2,000']);

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5 } },
};

function CellContent({ value, highlighted }: { value: boolean | string; highlighted?: boolean }) {
  if (value === true) {
    return <Check className={`w-4 h-4 mx-auto ${highlighted ? 'text-lime' : 'text-lime'}`} />;
  }
  if (value === false) {
    return <Minus className="w-4 h-4 mx-auto text-ink" aria-hidden="true" />;
  }
  return <span className="text-xs text-paper">{value}</span>;
}

export default function Pricing() {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const motionInitial = reduceMotion ? 'visible' : 'hidden';
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual');
  const isAnnual = billing === 'annual';

  const plans: {
    key: Tier;
    pricing: { monthly: string; annual: string };
    originalAnnualPrice?: string;
    highlightCount: number;
    url: string;
  }[] = [
    { key: 'free', pricing: { monthly: '$0', annual: '$0' }, highlightCount: 5, url: 'https://app.claimtagx.com/signup' },
    { key: 'basic', pricing: { monthly: '$30', annual: '$25' }, highlightCount: 6, url: 'https://app.claimtagx.com/signup' },
    { key: 'essential', pricing: { monthly: '$65', annual: '$50' }, highlightCount: 7, url: 'https://app.claimtagx.com/signup' },
    { key: 'advanced', pricing: { monthly: '$120', annual: '$80' }, originalAnnualPrice: '$100', highlightCount: 8, url: 'https://app.claimtagx.com/signup' },
    { key: 'enterprise', pricing: { monthly: t('home.pricing.plans.enterprise.price'), annual: t('home.pricing.plans.enterprise.price') }, highlightCount: 8, url: 'mailto:sales@claimtagx.com' },
  ];

  const matrix: Group[] = [
  {
    category: 'capacity',
    rows: [
      { feature: 'stations', values: { free: '1', basic: '1', essential: '5', advanced: 'unlimited', enterprise: 'unlimited' } },
      { feature: 'staff', values: { free: '1', basic: '5', essential: '25', advanced: 'unlimited', enterprise: 'unlimited' } },
      { feature: 'ticketsMonth', values: { free: '15', basic: '250', essential: '1,000', advanced: '2,000', enterprise: 'unlimited' } },
      { feature: 'ticketType', values: { free: 'textOnly', basic: 'ootbTemplate', essential: 'configurableShared', advanced: 'multiTemplate', enterprise: 'fullyCustomizable' } },
    ],
  },
  {
    category: 'core',
    rows: [
      { feature: 'fullLifecycle', values: { free: false, basic: true, essential: true, advanced: true, enterprise: true } },
      { feature: 'multiAsset', values: { free: false, basic: 'limited', essential: true, advanced: true, enterprise: true } },
      { feature: 'workflow', values: { free: false, basic: false, essential: 'basic', advanced: 'advanced', enterprise: 'full' } },
      { feature: 'perStationConfig', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'issuance',
    rows: [
      { feature: 'webLink', values: { free: 'textOnly', basic: true, essential: true, advanced: true, enterprise: true } },
      { feature: 'emailDelivery', values: { free: false, basic: true, essential: true, advanced: true, enterprise: true } },
      { feature: 'qrClaim', values: { free: false, basic: 'static', essential: 'dynamicOtp', advanced: 'dynamicOtp', enterprise: 'full' } },
      { feature: 'smsWhatsapp', note: 'sms', values: { free: false, basic: true, essential: true, advanced: true, enterprise: true } },
      { feature: 'nfcBleTransfer', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'inAppPush', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'offlineIssuance', values: { free: false, basic: true, essential: true, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'input',
    rows: [
      { feature: 'manualEntry', values: { free: true, basic: true, essential: true, advanced: true, enterprise: true } },
      { feature: 'photoCapture', values: { free: false, basic: true, essential: true, advanced: true, enterprise: true } },
      { feature: 'aiCapture', note: 'ai', values: { free: false, basic: false, essential: 'basic', advanced: 'advanced', enterprise: 'full' } },
      { feature: 'lookup', values: { free: false, basic: true, essential: true, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'workforce',
    rows: [
      { feature: 'staffAccounts', values: { free: 'oneOnly', basic: 'basic', essential: 'full', advanced: 'full', enterprise: 'full' } },
      { feature: 'shiftMgmt', values: { free: false, basic: false, essential: 'basic', advanced: 'advanced', enterprise: 'full' } },
      { feature: 'handlerAssign', values: { free: false, basic: 'manual', essential: 'rotation', advanced: 'fullSla', enterprise: 'full' } },
      { feature: 'taskMgmt', values: { free: false, basic: false, essential: 'basic', advanced: 'advanced', enterprise: 'full' } },
      { feature: 'supervisor', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'custody',
    rows: [
      { feature: 'csrUnstructured', values: { free: false, basic: 'optional', essential: true, advanced: true, enterprise: true } },
      { feature: 'csrStructured', values: { free: false, basic: false, essential: true, advanced: true, enterprise: true } },
      { feature: 'capacityTracking', values: { free: false, basic: false, essential: true, advanced: true, enterprise: true } },
      { feature: 'multiLayer', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'crossStation', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'validation',
    rows: [
      { feature: 'staticQr', values: { free: false, basic: true, essential: true, advanced: true, enterprise: true } },
      { feature: 'dynamicQr', values: { free: false, basic: false, essential: true, advanced: true, enterprise: true } },
      { feature: 'pin', values: { free: false, basic: 'optional', essential: true, advanced: true, enterprise: true } },
      { feature: 'otp', values: { free: false, basic: false, essential: true, advanced: true, enterprise: true } },
      { feature: 'nfcBle', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'biometric', values: { free: false, basic: false, essential: false, advanced: false, enterprise: true } },
      { feature: 'validationRules', values: { free: false, basic: false, essential: 'basic', advanced: 'advanced', enterprise: 'full' } },
    ],
  },
  {
    category: 'control',
    rows: [
      { feature: 'validationLogs', values: { free: false, basic: false, essential: 'basic', advanced: 'full', enterprise: 'full' } },
      { feature: 'disputeMgmt', values: { free: false, basic: false, essential: 'basicLogOnly', advanced: 'fullWorkflow', enterprise: 'full' } },
      { feature: 'notesText', values: { free: false, basic: false, essential: true, advanced: true, enterprise: true } },
      { feature: 'notesVoice', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'auditLogs', values: { free: false, basic: false, essential: 'basic', advanced: 'full', enterprise: 'full' } },
    ],
  },
  {
    category: 'communication',
    rows: [
      { feature: 'notifications', values: { free: false, basic: 'basic', essential: 'full', advanced: 'advanced', enterprise: 'full' } },
      { feature: 'patronMessaging', values: { free: false, basic: false, essential: true, advanced: true, enterprise: true } },
      { feature: 'internalMessaging', values: { free: false, basic: false, essential: 'limited', advanced: 'full', enterprise: 'full' } },
      { feature: 'intercom', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'revenue',
    rows: [
      { feature: 'paidServices', values: { free: false, basic: 'basic', essential: 'tiered', advanced: 'advanced', enterprise: 'full' } },
      { feature: 'servicePricing', values: { free: false, basic: 'flat', essential: 'tiered', advanced: 'advanced', enterprise: 'advanced' } },
      { feature: 'ancillary', values: { free: false, basic: false, essential: 'limited', advanced: true, enterprise: true } },
      { feature: 'invoice', values: { free: false, basic: 'basic', essential: 'full', advanced: 'full', enterprise: 'full' } },
    ],
  },
  {
    category: 'marketplace',
    rows: [
      { feature: 'marketplaceBuy', values: { free: false, basic: false, essential: true, advanced: true, enterprise: true } },
      { feature: 'marketplaceSell', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'ticketMarket', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'freeTemplate', values: { free: false, basic: false, essential: false, advanced: 'oneIncluded', enterprise: 'custom' } },
    ],
  },
  {
    category: 'ai',
    rows: [
      { feature: 'aiSuggestions', values: { free: false, basic: false, essential: 'basic', advanced: 'advanced', enterprise: 'full' } },
      { feature: 'insights', values: { free: false, basic: false, essential: 'basic', advanced: 'advanced', enterprise: 'predictive' } },
      { feature: 'disputeAssist', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'predictive', values: { free: false, basic: false, essential: false, advanced: false, enterprise: true } },
    ],
  },
  {
    category: 'branding',
    rows: [
      { feature: 'logoBranding', values: { free: false, basic: true, essential: true, advanced: true, enterprise: true } },
      { feature: 'templateCustom', values: { free: false, basic: false, essential: 'limited', advanced: 'full', enterprise: 'full' } },
      { feature: 'perStationBrand', values: { free: false, basic: false, essential: false, advanced: true, enterprise: true } },
      { feature: 'whiteLabel', values: { free: false, basic: false, essential: false, advanced: 'partial', enterprise: 'full' } },
    ],
  },
  {
    category: 'integrations',
    rows: [
      { feature: 'apiAccess', values: { free: false, basic: false, essential: false, advanced: 'limited', enterprise: 'full' } },
      { feature: 'thirdParty', values: { free: false, basic: false, essential: 'limited', advanced: 'advanced', enterprise: 'full' } },
      { feature: 'deployment', values: { free: 'cloudOnly', basic: 'cloud', essential: 'cloud', advanced: 'cloud', enterprise: 'cloudOnPrem' } },
      { feature: 'multiRegion', values: { free: false, basic: false, essential: false, advanced: false, enterprise: true } },
    ],
  },
  ];

  const resolveCell = (value: Cell): boolean | string =>
    typeof value !== 'string' || numericCells.has(value) ? value : t(`home.pricing.cells.${value}`);

  return (
    <section id="pricing" className="py-24 md:py-32 bg-obsidian border-t border-white/5 relative overflow-hidden">
      <div className="absolute top-0 end-0 w-[800px] h-[800px] bg-[radial-gradient(circle_at_center,_rgba(198,242,78,0.03),_transparent_60%)] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={motionInitial}
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={containerVariants}
          className="flex flex-col items-center text-center mb-20"
        >
          <motion.div variants={itemVariants} className="mb-6">
            <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-obsidian px-3 py-1 rounded-sm">
              {t('home.pricing.eyebrow')}
            </span>
          </motion.div>

          <motion.h2 variants={itemVariants} className="text-3xl md:text-5xl font-bold text-paper mb-6">
            {t('home.pricing.title')}
          </motion.h2>

          <motion.p variants={itemVariants} className="text-lg text-ink max-w-2xl">
            {t('home.pricing.subtitle')}
          </motion.p>

          {/* Billing toggle */}
          <motion.div variants={itemVariants} className="flex items-center gap-4 mt-10">
            <span className="text-sm font-medium text-paper">{t('home.pricing.monthly')}</span>
            <button
              onClick={() => setBilling(billing === 'monthly' ? 'annual' : 'monthly')}
              aria-label={t('home.pricing.toggleAria')}
              className={`relative w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime ${
                billing === 'annual' ? 'bg-lime' : 'bg-steel'
              }`}
            >
              <span
                className={`absolute start-1 top-1 w-5 h-5 rounded-full transition-transform duration-300 ${
                  billing === 'annual' ? 'ltr:translate-x-7 rtl:-translate-x-7 bg-obsidian' : 'translate-x-0 bg-obsidian'
                }`}
              />
            </button>
            <span className="text-sm font-medium text-paper">{t('home.pricing.annual')}</span>
            <span className="text-obsidian bg-lime px-1.5 py-0.5 rounded text-xs font-bold">{t('home.pricing.saveUpTo')}</span>
          </motion.div>
        </motion.div>

        {/* Tier cards */}
        <motion.div
          initial={motionInitial}
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={containerVariants}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 mb-24"
        >
          {plans.map((plan) => {
            const isMostPopular = plan.key === 'essential';
            const showAnnualDiscount = isAnnual && plan.key === 'advanced';
            const discountLabel = t('home.pricing.plans.advanced.discountLabel');

            return (
            <motion.div
              key={plan.key}
              variants={itemVariants}
              whileHover={reduceMotion ? undefined : { y: -6 }}
                  className={`relative isolate overflow-hidden flex flex-col rounded-2xl p-6 ${
                isMostPopular
                  ? 'bg-steel border-2 border-lime/50 shadow-[0_0_30px_rgba(198,242,78,0.15)]'
                  : 'bg-steel border border-white/10 hover:border-lime/30 hover:shadow-xl'
              }`}
            >
              {isMostPopular && (
                <div className="self-center mb-3 w-full text-center bg-paper text-obsidian px-3 py-1 rounded-md text-xs font-extrabold tracking-widest uppercase">
                  {t('home.pricing.mostPopular')}
                </div>
              )}

              {showAnnualDiscount && (
                <div className="mb-3 w-full text-center bg-paper text-obsidian px-2.5 py-1 rounded-md text-xs font-extrabold uppercase">
                  {discountLabel}
                </div>
              )}

              <div className="mb-6 mt-1">
                <h3 className="font-mono font-bold text-xs tracking-widest uppercase mb-3 text-paper">
                  {t(`home.pricing.plans.${plan.key}.name`)}
                </h3>
                {showAnnualDiscount && (
                  <div className="w-full text-center bg-paper text-obsidian px-2 py-0.5 rounded-md text-xs font-extrabold tracking-wide mb-2">
                    {t('home.pricing.limitedTime', { discount: discountLabel })}
                  </div>
                )}
                <div className="flex items-baseline gap-1 mb-3">
                  {showAnnualDiscount && plan.originalAnnualPrice && (
                    <span className="text-ink line-through text-xl font-bold me-1">{plan.originalAnnualPrice}</span>
                  )}
                  <span className="text-4xl font-extrabold text-paper tracking-tight">{plan.pricing[billing]}</span>
                  {plan.key !== 'enterprise' && <span className="text-ink text-sm font-medium">{t('home.pricing.periodMonth')}</span>}
                </div>
                <p className="text-ink text-xs leading-relaxed min-h-[3rem]">{t(`home.pricing.plans.${plan.key}.description`)}</p>
              </div>

              <div className="flex-1">
                <ul className="space-y-3 mb-8">
                  {Array.from({ length: plan.highlightCount }, (_, index) => index + 1).map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2.5">
                      <Check className={`w-4 h-4 mt-0.5 shrink-0 ${isMostPopular ? 'text-lime' : 'text-lime'}`} />
                      <span className="text-xs text-paper font-medium leading-relaxed">
                        {t(`home.pricing.plans.${plan.key}.h${highlight}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <a
                href={plan.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`w-full text-center py-3 rounded-xl font-bold text-sm mt-auto border ${
                  isMostPopular || plan.key === 'enterprise'
                    ? 'cta-lime border-lime text-obsidian'
                    : 'cta-steel border-white text-paper'
                }`}
              >
                {t(plan.key === 'enterprise' ? 'home.pricing.contactSales' : 'home.pricing.startFree')}
              </a>
            </motion.div>
            );
          })}
        </motion.div>

        {/* Full feature matrix */}
        <motion.div
          initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="mt-12"
        >
          <div className="text-center mb-10">
            <h3 className="text-2xl md:text-3xl font-bold text-paper mb-3">{t('home.pricing.matrixTitle')}</h3>
            <p className="text-ink text-sm">{t('home.pricing.matrixSubtitle')}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-steel overflow-hidden">
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label={t('home.pricing.matrixTitle')}
            >
              <table className="w-full min-w-[860px] text-start bg-obsidian text-paper">
                <thead className="sticky top-0 bg-obsidian z-10">
                  <tr className="border-b border-white/10">
                    <th className="py-4 px-5 text-xs font-mono font-bold uppercase tracking-widest text-paper bg-obsidian w-[28%]">{t('home.pricing.featureCol')}</th>
                    {tierOrder.map((tier) => (
                      <th
                        key={tier}
                        className="py-4 px-3 text-center text-xs font-mono font-bold uppercase tracking-widest text-paper bg-obsidian"
                      >
                        {t(`home.pricing.tiers.${tier}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((group) => (
                    <Fragment key={group.category}>
                      <tr className="bg-obsidian">
                        <td colSpan={6} className="py-3 px-5 text-[11px] font-mono font-bold uppercase tracking-widest text-paper bg-obsidian">
                          {t(`home.pricing.categories.${group.category}`)}
                        </td>
                      </tr>
                      {group.rows.map((row, rIdx) => (
                        <tr
                          key={`${group.category}-${row.feature}`}
                          className="border-t border-white/5 bg-obsidian"
                        >
                          <td className="py-3 px-5 text-sm text-paper font-medium bg-obsidian">
                            {t(`home.pricing.features.${row.feature}`)}
                            {row.note && (
                              <span className="block text-[11px] text-paper font-normal mt-0.5">{t(`home.pricing.notes.${row.note}`)}</span>
                            )}
                          </td>
                          {tierOrder.map((tier) => (
                            <td
                              key={tier}
                              className="py-3 px-3 text-center align-middle bg-obsidian"
                            >
                              <CellContent value={resolveCell(row.values[tier])} highlighted={tier === 'essential'} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-center mt-10">
            <p className="text-ink text-sm mb-5">{t('home.pricing.needCustom')}</p>
            <a
              href="mailto:sales@claimtagx.com"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl cta-steel border border-white/20 font-bold text-sm"
            >
              {t('home.pricing.contactSales')}
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
