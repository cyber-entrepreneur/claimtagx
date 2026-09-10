import { motion } from 'framer-motion';
import { ArrowRight, Camera, Check, Clock, QrCode, ShieldCheck } from 'lucide-react';
import SEO from '@/components/SEO';
import { track } from '@/lib/analytics';

const timeline = [
  { label: 'Checked in', detail: 'Photos captured · Handler: Alex M.', time: '7:42 PM', done: true },
  { label: 'In custody', detail: 'Spot B12 · Level 2', time: '7:43 PM', done: true },
  { label: 'Ready for pickup', detail: 'Present QR below to release', time: 'Now', done: false },
];

export default function DemoTicket() {
  return (
    <>
      <SEO
        title="Sample Guest Ticket — ClaimTagX"
        description="This is what your guests see: a live digital claim ticket with photo proof, status tracking, and QR verification. No app, no account — just a link."
        url="https://claimtagx.com/demo-ticket"
      />
      <div className="bg-obsidian min-h-screen pt-28 pb-20 px-4">
        <div className="max-w-md mx-auto">
          {/* Demo banner */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-2 mb-6"
          >
            <span className="font-mono text-xs font-bold text-lime tracking-[0.2em] uppercase bg-lime/10 border border-lime/20 px-3 py-1.5 rounded-full">
              Sample ticket — this is what your guest sees
            </span>
          </motion.div>

          {/* The ticket */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-steel border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="bg-obsidian/60 border-b border-white/10 p-6 flex items-center justify-between">
              <div>
                <p className="font-mono text-xs text-ink uppercase tracking-wider mb-1">The Grandview Hotel · Valet</p>
                <p className="text-white font-bold text-xl font-mono">Ticket #4839</p>
              </div>
              <div className="flex items-center gap-1.5 bg-lime/10 border border-lime/30 rounded-full px-3 py-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-lime" />
                <span className="text-xs font-bold text-lime font-mono">VERIFIED</span>
              </div>
            </div>

            {/* Item */}
            <div className="p-6 border-b border-white/5">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-obsidian rounded-xl border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Camera className="w-6 h-6 text-lime" />
                </div>
                <div>
                  <p className="text-white font-semibold">Black SUV · Plate 8-XKR-442</p>
                  <p className="text-ink text-sm mt-1">4 intake photos on record — condition documented at 7:42 PM</p>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="p-6 border-b border-white/5">
              <div className="flex flex-col gap-5">
                {timeline.map((step) => (
                  <div key={step.label} className="flex items-start gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        step.done ? 'bg-lime text-obsidian' : 'bg-lime/15 border border-lime text-lime'
                      }`}
                    >
                      {step.done ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between">
                        <p className={`font-semibold ${step.done ? 'text-white' : 'text-lime'}`}>{step.label}</p>
                        <p className="text-xs text-ink font-mono">{step.time}</p>
                      </div>
                      <p className="text-sm text-ink">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* QR */}
            <div className="p-8 flex flex-col items-center bg-obsidian/40">
              <div className="bg-white p-4 rounded-2xl mb-4">
                <QrCode className="w-28 h-28 text-obsidian" strokeWidth={1.25} />
              </div>
              <p className="text-sm text-ink text-center">
                Show this code at pickup. One scan verifies you — and releases your vehicle.
              </p>
            </div>
          </motion.div>

          {/* The pitch under the ticket */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-center mt-10"
          >
            <h1 className="text-2xl font-bold text-white mb-3">
              Notice what you didn't do?
            </h1>
            <p className="text-ink leading-relaxed mb-8">
              No app store. No account. No download. This ticket is a link — delivered by
              text, WhatsApp, or email — and it works on every phone your guests own.
            </p>
            <a
              href="https://app.claimtagx.com/signup"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('cta_clicked', { action: 'start_free', location: 'demo_ticket' })}
              className="inline-flex items-center justify-center gap-2 bg-lime text-obsidian px-8 py-4 rounded-xl font-bold text-lg hover:bg-lime-hover hover:shadow-[0_0_30px_rgba(198,242,78,0.4)] transition-all duration-200"
            >
              Issue tickets like this — free
              <ArrowRight className="w-5 h-5" />
            </a>
            <p className="text-xs text-ink/60 mt-4">Free plan forever · No credit card · Live in 60 seconds</p>
          </motion.div>
        </div>
      </div>
    </>
  );
}
