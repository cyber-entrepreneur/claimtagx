import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fetchMyInvitations } from "@/lib/api";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { setBaseUrl } from "@workspace/api-client-react";
import { API_BASE_URL } from "@/lib/api-base";

import { StoreProvider, useStore } from "@/lib/store";
import { Shell } from "@/components/handler/Shell";
import HandlerLogin from "@/pages/HandlerLogin";
import VenuePicker from "@/pages/VenuePicker";
import Invitations from "@/pages/Invitations";
import Intake from "@/pages/Intake";
import Custody from "@/pages/Custody";
import Home from "@/pages/Home";
import History from "@/pages/History";
import Release from "@/pages/Release";
import Settings from "@/pages/Settings";
import SettingsProfile from "@/pages/settings/Profile";
import SettingsAttendance from "@/pages/settings/Attendance";
import SettingsPerformance from "@/pages/settings/Performance";
import SettingsSecurity from "@/pages/settings/Security";
import MessagesPage from "@/pages/Messages";
import IntercomPage from "@/pages/Intercom";
import ServicesPage from "@/pages/Services";
import AssignmentsPage from "@/pages/Assignments";
import StationPage from "@/pages/Station";
import PreShiftPage from "@/pages/PreShift";
import CheckoutPage from "@/pages/Checkout";
import { IssueNfcPage, IssueQrPage, IssueSmsPage } from "@/pages/IssueQuick";
import IssueSuccess from "@/pages/IssueSuccess";
import OnboardingPicker from "@/pages/OnboardingPicker";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient();

// Point the generated API client at the configured base once. Auth is handled
// entirely by the httpOnly session cookie (`credentials: "include"`), so no
// bearer token getter is wired up.
setBaseUrl(API_BASE_URL || null);

function LoadingScreen() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-obsidian text-slate font-mono text-sm">
      Loading…
    </div>
  );
}

function AuthedRoutes() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/intake" component={Intake} />
        <Route path="/custody" component={Custody} />
        <Route path="/release" component={Release} />
        <Route path="/history" component={History} />
        <Route path="/messages" component={MessagesPage} />
        <Route path="/intercom" component={IntercomPage} />
        <Route path="/services" component={ServicesPage} />
        <Route path="/assignments" component={AssignmentsPage} />
        <Route path="/assignments/:scope" component={AssignmentsPage} />
        <Route path="/station" component={StationPage} />
        <Route path="/pre-shift" component={PreShiftPage} />
        <Route path="/checkout" component={CheckoutPage} />
        <Route path="/issue/nfc" component={IssueNfcPage} />
        <Route path="/issue/qr" component={IssueQrPage} />
        <Route path="/issue/sms" component={IssueSmsPage} />
        <Route path="/issue/success" component={IssueSuccess} />
        <Route path="/onboard" component={OnboardingPicker} />
        <Route path="/settings" component={Settings} />
        <Route path="/settings/profile" component={SettingsProfile} />
        <Route path="/settings/attendance" component={SettingsAttendance} />
        <Route path="/settings/performance" component={SettingsPerformance} />
        <Route path="/settings/security" component={SettingsSecurity} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function SignInPage() {
  const { ready, signedIn } = useStore();
  if (!ready) return <LoadingScreen />;
  if (signedIn) return <Redirect to="/" />;
  return <HandlerLogin />;
}

function Gate() {
  const { ready, signedIn, session, venues } = useStore();
  // Look up pending email invitations for this user. We need this in the gate
  // so a freshly-invited handler with zero memberships lands on the
  // invitations screen (not the venue picker, which they can't use).
  const invitations = useQuery({
    queryKey: ["my-invitations"],
    queryFn: fetchMyInvitations,
    enabled: Boolean(signedIn && venues.length === 0),
    staleTime: 30_000,
  });
  if (!ready) return <LoadingScreen />;
  if (!signedIn) return <Redirect to="/sign-in" />;
  if (!session || venues.length === 0) {
    if (invitations.isLoading) return <LoadingScreen />;
    if ((invitations.data ?? []).length > 0) return <Invitations />;
    return <VenuePicker />;
  }
  return <AuthedRoutes />;
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <QueryClientProvider client={queryClient}>
          <StoreProvider>
            <Switch>
              <Route path="/sign-in" component={SignInPage} />
              <Route path="/sign-up">
                <Redirect to="/sign-in" />
              </Route>
              <Route>
                <Gate />
              </Route>
            </Switch>
            <Toaster />
          </StoreProvider>
        </QueryClientProvider>
      </WouterRouter>
    </TooltipProvider>
  );
}

export default App;
