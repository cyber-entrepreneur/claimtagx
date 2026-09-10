import { Link } from "wouter";
import { Linkedin, Twitter, Instagram } from "lucide-react";
import { useI18n } from "@/lib/i18n";

function ThreadsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.7 11.2c-.1 0-.2-.1-.3-.1-.2-3.1-1.9-4.9-4.7-4.9-1.7 0-3.1.7-4 2l1.6 1.1c.6-.9 1.6-1.1 2.4-1.1 1.6 0 2.4 1 2.6 2.4-.7-.1-1.4-.2-2.2-.2-2.6 0-4.4 1.5-4.4 3.6 0 1.9 1.6 3.4 3.7 3.4 2.3 0 3.5-1.3 4-2.6.6.4 1 1.1 1.2 1.9.3 1.4-.7 2.6-2.7 2.6-1.6 0-2.7-.5-3.5-1.2L7 19.6c1.1 1 2.7 1.5 4.7 1.5 3.5 0 4.9-2 4.9-4.4 0-1-.4-2.1-1.1-2.9.5-.4.8-.9 1-1.5.5-1.4-.4-2.5-1.2-2.7zm-4.4 4.6c-.7 0-1.7-.4-1.7-1.4 0-.8.7-1.5 2.1-1.5.7 0 1.4.1 2 .2-.2 1.6-1.1 2.7-2.4 2.7z"/>
    </svg>
  );
}

function TikTokIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.6 6.3c-1.4 0-2.6-.7-3.4-1.8-.4-.5-.6-1.2-.7-1.9V2h-3v12.4c0 1.4-1.1 2.5-2.5 2.5S7.5 15.8 7.5 14.4s1.1-2.5 2.5-2.5c.3 0 .5 0 .8.1V8.9c-.3 0-.5-.1-.8-.1C7 8.8 4.5 11.3 4.5 14.4s2.5 5.6 5.6 5.6 5.6-2.5 5.6-5.6V8.7c1.1.8 2.5 1.3 4 1.3V7c-.1-.3-.1-.4-.1-.7z"/>
    </svg>
  );
}

export default function Footer() {
  const { t, localizedPath } = useI18n();
  const currentYear = new Date().getFullYear();
  const home = localizedPath("/");

  return (
    <footer className="bg-[#05080f] pt-20 pb-10 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-12 md:gap-8 lg:gap-12 mb-16">
          <div className="col-span-1 md:col-span-1 lg:col-span-1">
            <Link href={home} className="flex items-center gap-1 mb-4 inline-block">
              <span className="font-sans font-extrabold text-2xl tracking-tight text-white">Claim</span>
              <span className="font-sans font-extrabold text-2xl tracking-tight text-lime">TagX</span>
            </Link>
            <p className="text-ink text-sm leading-relaxed max-w-xs">{t("footer.tagline")}</p>
          </div>

          <div className="col-span-1">
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">{t("footer.product")}</h4>
            <ul className="flex flex-col gap-3">
              <li><a href={`${home}#features`} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.features")}</a></li>
              <li><Link href={localizedPath("/price")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.pricing")}</Link></li>
              <li><a href={`${home}#industries`} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.industries")}</a></li>
              <li><a href={`${home}#how`} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.howItWorks")}</a></li>
            </ul>
          </div>

          <div className="col-span-1">
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">{t("footer.solutions")}</h4>
            <ul className="flex flex-col gap-3">
              <li><Link href={localizedPath("/solutions/hotels")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.hotels")}</Link></li>
              <li><Link href={localizedPath("/solutions/clubs-restaurants")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.clubs")}</Link></li>
              <li><Link href={localizedPath("/solutions/beach-clubs")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.beachClubs")}</Link></li>
              <li><Link href={localizedPath("/solutions/valet")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.valet")}</Link></li>
              <li><Link href={localizedPath("/solutions/dry-cleaning")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.dryCleaning")}</Link></li>
              <li><Link href={localizedPath("/solutions/luggage")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.luggage")}</Link></li>
              <li><Link href={localizedPath("/solutions/repair")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.repair")}</Link></li>
              <li><Link href={localizedPath("/solutions/airlines")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.airlines")}</Link></li>
            </ul>
          </div>

          <div className="col-span-1">
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">{t("footer.company")}</h4>
            <ul className="flex flex-col gap-3">
              <li><Link href={localizedPath("/contact")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.contact")}</Link></li>
              <li><a href="mailto:info@claimtagx.com" className="text-ink hover:text-lime transition-colors text-sm">{t("footer.sendEmail")}</a></li>
              <li><a href="https://linkedin.com/company/Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-lime transition-colors text-sm">LinkedIn</a></li>
              <li><a href="https://x.com/Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-lime transition-colors text-sm">X</a></li>
              <li><a href="https://instagram.com/Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-lime transition-colors text-sm">Instagram</a></li>
              <li><a href="https://threads.net/@Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-lime transition-colors text-sm">Threads</a></li>
              <li><a href="https://tiktok.com/@Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-lime transition-colors text-sm">TikTok</a></li>
            </ul>
          </div>

          <div className="col-span-1">
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">{t("footer.legal")}</h4>
            <ul className="flex flex-col gap-3">
              <li><Link href={localizedPath("/security")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.security")}</Link></li>
              <li><Link href={localizedPath("/privacy")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.privacy")}</Link></li>
              <li><Link href={localizedPath("/terms")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.terms")}</Link></li>
              <li><Link href={localizedPath("/refund")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.refund")}</Link></li>
              <li><Link href={localizedPath("/cookies")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.cookies")}</Link></li>
              <li><Link href={localizedPath("/gdpr")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.gdpr")}</Link></li>
              <li><Link href={localizedPath("/dpa")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.dpa")}</Link></li>
              <li><Link href={localizedPath("/aup")} className="text-ink hover:text-lime transition-colors text-sm">{t("footer.aup")}</Link></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-ink text-sm">{t("footer.copyright", { year: currentYear })}</p>
          <div className="flex gap-4">
            <a href="https://linkedin.com/company/Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-white transition-colors" aria-label="LinkedIn">
              <Linkedin size={20} />
            </a>
            <a href="https://x.com/Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-white transition-colors" aria-label="X">
              <Twitter size={20} />
            </a>
            <a href="https://instagram.com/Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-white transition-colors" aria-label="Instagram">
              <Instagram size={20} />
            </a>
            <a href="https://threads.net/@Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-white transition-colors" aria-label="Threads">
              <ThreadsIcon size={20} />
            </a>
            <a href="https://tiktok.com/@Claimtagx" target="_blank" rel="noopener noreferrer" className="text-ink hover:text-white transition-colors" aria-label="TikTok">
              <TikTokIcon size={20} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
