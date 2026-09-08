import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { stripLocalePrefix, useI18n } from "@/lib/i18n";
import { track } from "@/lib/analytics";

export default function Nav() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [location] = useLocation();
  const { t, localizedPath } = useI18n();
  const homePath = localizedPath("/");
  const isHome = stripLocalePrefix(location) === "/";

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: t("nav.howItWorks"), href: isHome ? "#how" : `${homePath}#how`, anchor: true },
    { name: t("nav.features"), href: isHome ? "#features" : `${homePath}#features`, anchor: true },
    { name: t("nav.industries"), href: isHome ? "#industries" : `${homePath}#industries`, anchor: true },
    { name: t("nav.contact"), href: localizedPath("/contact"), anchor: false },
    { name: t("nav.pricing"), href: localizedPath("/price"), anchor: false },
  ];

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 border-b ${
        isScrolled
          ? "bg-obsidian/95 backdrop-blur-md border-white/5 shadow-sm py-3"
          : "bg-obsidian/85 backdrop-blur-sm border-transparent py-5"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        <Link href={homePath} className="flex items-center gap-1 group">
          <span className="font-sans font-extrabold text-2xl tracking-tight text-white">Claim</span>
          <span className="font-sans font-extrabold text-2xl tracking-tight text-lime group-hover:text-lime-hover transition-colors">
            TagX
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 lg:gap-8">
          {navLinks.map((link) =>
            link.anchor ? (
              <a
                key={link.name}
                href={link.href}
                className="text-sm font-medium text-ink hover:text-white transition-colors"
              >
                {link.name}
              </a>
            ) : (
              <Link
                key={link.name}
                href={link.href}
                className="text-sm font-medium text-ink hover:text-white transition-colors"
              >
                {link.name}
              </Link>
            ),
          )}
          <LocaleSwitcher />
          <a
            href="https://calendly.com/claimtagx/demo"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("cta_clicked", { action: "book_demo", location: "nav" })}
            className="text-sm font-semibold text-white px-4 py-2.5 rounded-lg border border-white/15 hover:border-lime/40 hover:text-lime transition-all duration-200 inline-block"
          >
            {t("nav.bookDemo")}
          </a>
          <a
            href="https://app.claimtagx.com/signup"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("cta_clicked", { action: "start_free", location: "nav" })}
            className="bg-lime text-obsidian px-5 py-2.5 rounded-lg font-semibold text-sm hover:bg-lime-hover hover:-translate-y-px hover:shadow-[0_0_20px_rgba(198,242,78,0.3)] transition-all duration-200 inline-block"
          >
            {t("nav.startFree")}
          </a>
        </nav>

        <div className="md:hidden flex items-center gap-2">
          <LocaleSwitcher compact />
          <button
            className="text-white p-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-obsidian border-b border-white/10 overflow-hidden"
          >
            <div className="px-4 pt-4 pb-6 flex flex-col gap-4">
              {navLinks.map((link) =>
                link.anchor ? (
                  <a
                    key={link.name}
                    href={link.href}
                    className="text-base font-medium text-ink hover:text-white py-2 border-b border-white/5"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.name}
                  </a>
                ) : (
                  <Link
                    key={link.name}
                    href={link.href}
                    className="text-base font-medium text-ink hover:text-white py-2 border-b border-white/5"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.name}
                  </Link>
                ),
              )}
              <a
                href="https://calendly.com/claimtagx/demo"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/15 text-white px-5 py-3 rounded-lg font-semibold text-center mt-2"
                onClick={() => {
                  track("cta_clicked", { action: "book_demo", location: "nav_mobile" });
                  setMobileMenuOpen(false);
                }}
              >
                {t("nav.bookDemo")}
              </a>
              <a
                href="https://app.claimtagx.com/signup"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-lime text-obsidian px-5 py-3 rounded-lg font-semibold text-center"
                onClick={() => {
                  track("cta_clicked", { action: "start_free", location: "nav_mobile" });
                  setMobileMenuOpen(false);
                }}
              >
                {t("nav.startFree")}
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
