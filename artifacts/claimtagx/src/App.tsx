import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import AdminApp from "@/pages/admin/AdminApp";

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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/contact" component={Contact} />
      <Route path="/solutions/:slug" component={SolutionPage} />
      <Route path="/demo-ticket" component={DemoTicket} />
      <Route path="/security" component={Security} />
      <Route path="/handler" component={HandlerRedirect} />
      <Route path="/handler/sign-in/*?" component={HandlerRedirect} />
      <Route path="/handler/sign-up/*?" component={HandlerRedirect} />
      <Route path="/handler/sso-callback/*?" component={HandlerRedirect} />
      <Route path="/price" component={PricingPage} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/gdpr" component={GDPR} />
      <Route path="/dpa" component={DPA} />
      <Route path="/cookies" component={Cookies} />
      <Route path="/aup" component={AUP} />
      <Route path="/refund" component={Refund} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ScrollToTop />
          <AppShell />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function AppShell() {
  const [location] = useLocation();
  const isAdmin = location.startsWith("/admin");
  if (isAdmin) {
    return <AdminApp />;
  }
  return (
    <div className="flex min-h-screen flex-col bg-obsidian text-paper font-sans">
      <Nav />
      <main className="flex-1">
        <Router />
      </main>
      <Footer />
      <CookieBanner />
    </div>
  );
}

export default App;
