import { lazy, Suspense, useEffect, useSyncExternalStore, type ComponentType } from "react";
import { MotionConfig } from "framer-motion";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider, useI18n } from "@/lib/i18n";
import NotFound from "@/pages/not-found";

import Home from "@/pages/Home";
import Contact from "@/pages/Contact";
import PricingPage from "@/pages/Pricing";
import SolutionPage from "@/pages/Solution";
import DemoTicket from "@/pages/DemoTicket";
import Security from "@/pages/Security";
import Privacy from "@/pages/legal/Privacy";
import Terms from "@/pages/legal/Terms";
import GDPR from "@/pages/legal/GDPR";
import DPA from "@/pages/legal/DPA";
import Cookies from "@/pages/legal/Cookies";
import AUP from "@/pages/legal/AUP";
import Refund from "@/pages/legal/Refund";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CookieBanner from "@/components/CookieBanner";

const AdminApp = lazy(() => import("@/pages/admin/AdminApp"));

const queryClient = new QueryClient();

function HandlerRedirect() {
  if (typeof window !== "undefined") {
    const query = window.location.search ?? "";
    const hash = window.location.hash ?? "";
    window.location.replace(`/handler/${query}${hash}`);
  }

  return null;
}

function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    // Skip when navigating to an in-page anchor
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }
  }, [location]);

  return null;
}

function localeRoutes(prefix: string, routes: Array<{ path: string; component: ComponentType }>) {
  return routes.map(({ path, component: Component }) => (
    <Route key={`${prefix}${path}`} path={`${prefix}${path}`} component={Component} />
  ));
}

function Router() {
  const pages: Array<{ path: string; component: ComponentType }> = [
    { path: "/", component: Home },
    { path: "/contact", component: Contact },
    { path: "/demo-ticket", component: DemoTicket },
    { path: "/security", component: Security },
    { path: "/price", component: PricingPage },
    { path: "/privacy", component: Privacy },
    { path: "/terms", component: Terms },
    { path: "/gdpr", component: GDPR },
    { path: "/dpa", component: DPA },
    { path: "/cookies", component: Cookies },
    { path: "/aup", component: AUP },
    { path: "/refund", component: Refund },
  ];

  return (
    <Switch>
      {localeRoutes("", pages)}
      {localeRoutes("/ar", pages)}
      <Route path="/solutions/:slug" component={SolutionPage} />
      <Route path="/ar/solutions/:slug" component={SolutionPage} />
      <Route path="/handler" component={HandlerRedirect} />
      <Route path="/handler/sign-in/*?" component={HandlerRedirect} />
      <Route path="/handler/sign-up/*?" component={HandlerRedirect} />
      <Route path="/handler/sso-callback/*?" component={HandlerRedirect} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const e2eStable = useSyncExternalStore(
    () => () => undefined,
    () => document.documentElement.dataset.e2eStable === "1",
    () => false,
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion={e2eStable ? "always" : "user"}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <I18nProvider>
            <ScrollToTop />
            <AppShell />
          </I18nProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

function AppShell() {
  const [location] = useLocation();
  const { t } = useI18n();
  const isAdmin = location.startsWith("/admin");
  if (isAdmin) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-obsidian text-ink grid place-items-center">{t("common.loadingWorkspace")}</div>}>
        <AdminApp />
      </Suspense>
    );
  }
  return (
    <div className="flex min-h-screen flex-col bg-obsidian text-paper font-sans">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-lg focus:bg-lime focus:px-3 focus:py-2 focus:text-obsidian focus:font-semibold"
      >
        {t("common.skipToMain")}
      </a>
      <Nav />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        <Router />
      </main>
      <Footer />
      <CookieBanner />
    </div>
  );
}

export default App;
