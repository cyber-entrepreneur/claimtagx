import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import {
  BarChart3,
  Inbox,
  LogOut,
  Settings2,
  Wrench,
  FileText,
  Paperclip,
  Radio,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AuthError, fetchSession, logout, logoutAll, type StaffSession } from "./authApi";
import AdminLogin, { type SignInReason } from "./Login";
import AdminInbox from "./Inbox";
import InquiryWorkspace from "./InquiryWorkspace";
import AdminConfig from "./Config";
import AdminAnalytics from "./Analytics";
import AdminOperations from "./Operations";
import AdminMarketing from "./Marketing";
import AdminAttachments from "./Attachments";
import ChannelHealth from "./ChannelHealth";

type Me = StaffSession;

export default function AdminApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState<SignInReason | undefined>(undefined);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setLoading(true);

    const load = async (attempt: number): Promise<void> => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20_000);
      try {
        // fetchSession resolves to null on 401 (unauthenticated) and only
        // throws for suspended (403), network, or unexpected server errors.
        const data = await fetchSession({ signal: controller.signal });
        if (cancelled) return;
        setMe(data);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError && err.code === "suspended") {
          setMe(null);
          setReason("suspended");
          return;
        }
        if (err instanceof AuthError && err.code === "network" && attempt < 2) {
          await load(attempt + 1);
          return;
        }
        setMe(null);
        if (err instanceof AuthError && err.code === "network") {
          setLoadError("The admin API did not respond. Retry or confirm VITE_API_URL.");
        } else {
          setLoadError(err instanceof Error ? err.message : "Workspace unavailable");
        }
      } finally {
        window.clearTimeout(timer);
      }
    };

    void load(0).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async (everywhere: boolean) => {
    try {
      if (everywhere) await logoutAll();
      else await logout();
    } catch {
      // Even if the network call fails, drop local session state so the
      // operator is returned to the sign-in surface.
    }
    setConfirmSignOut(false);
    setMe(null);
    setReason(everywhere ? "signed_out_all" : "signed_out");
  };

  if (loading) {
    return <div className="min-h-screen bg-obsidian text-ink grid place-items-center">Loading workspace…</div>;
  }
  if (loadError) {
    return (
      <div className="min-h-screen bg-obsidian text-paper grid place-items-center p-6">
        <div className="max-w-md text-center space-y-3">
          <p role="alert">{loadError}</p>
          <button type="button" className="text-lime" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!me) return <AdminLogin onAuthed={setMe} reason={reason} />;

  const nav = [
    { href: "/admin/contact", label: "Inbox", icon: Inbox, permission: "inquiries.view" },
    { href: "/admin/contact/channels", label: "Channels", icon: Radio, permission: "inquiries.view" },
    { href: "/admin/contact/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view" },
    { href: "/admin/contact/config", label: "Configuration", icon: Settings2, permission: "config.manage" },
    { href: "/admin/contact/operations", label: "Operations", icon: Wrench, permission: "jobs.inspect" },
    { href: "/admin/contact/marketing", label: "Marketing CMS", icon: FileText, permission: "marketing.read" },
    { href: "/admin/contact/attachments", label: "Attachments", icon: Paperclip, permission: "attachments.manage" },
  ].filter((item) => me.permissions.includes(item.permission) || me.permissions.includes("*"));

  return (
    <div className="min-h-screen bg-obsidian text-paper flex">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-lg focus:bg-lime focus:px-3 focus:py-2 focus:text-obsidian focus:font-semibold"
      >
        Skip to workspace content
      </a>
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-white/10 px-4 py-6" aria-label="Admin navigation">
        <Link href="/admin/contact" className="font-extrabold text-lg mb-8">
          Claim<span className="text-lime">TagX</span>
          <span className="block text-[11px] font-medium text-ink tracking-wide mt-1">UNIFIED INBOX</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
            const active = location === item.href || (item.href !== "/admin/contact" && location.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  active ? "bg-white/10 text-white" : "text-ink hover:text-white"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto pt-6 text-xs text-ink">
          <p className="text-white font-medium truncate">{me.name}</p>
          <p className="truncate">{me.email}</p>
          {confirmSignOut ? (
            <div
              className="mt-3 space-y-2"
              role="group"
              aria-label="Confirm sign out"
            >
              <p className="text-white">Sign out?</p>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-left hover:text-white focus:outline-none focus:ring-2 focus:ring-lime"
                  onClick={() => void handleSignOut(false)}
                >
                  <LogOut className="w-3 h-3" /> This device
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-left hover:text-white focus:outline-none focus:ring-2 focus:ring-lime"
                  onClick={() => void handleSignOut(true)}
                >
                  <LogOut className="w-3 h-3" /> All devices
                </button>
                <button
                  type="button"
                  className="text-left hover:text-white focus:outline-none focus:ring-2 focus:ring-lime rounded"
                  onClick={() => setConfirmSignOut(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 hover:text-white focus:outline-none focus:ring-2 focus:ring-lime rounded"
              onClick={() => setConfirmSignOut(true)}
            >
              <LogOut className="w-3 h-3" /> Sign out
            </button>
          )}
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="font-bold">Unified inbox</span>
          <Link href="/admin/contact" className="text-sm text-lime">Inbox</Link>
        </header>
        <main id="admin-main" tabIndex={-1}>
        <Switch>
          <Route path="/admin">
            <Redirect to="/admin/contact" />
          </Route>
          <Route path="/admin/contact/analytics" component={AdminAnalytics} />
          <Route path="/admin/contact/config" component={AdminConfig} />
          <Route path="/admin/contact/operations" component={AdminOperations} />
          <Route path="/admin/contact/marketing" component={AdminMarketing} />
          <Route path="/admin/contact/attachments" component={AdminAttachments} />
          <Route path="/admin/contact/channels" component={ChannelHealth} />
          <Route path="/admin/contact/:id" component={InquiryWorkspace} />
          <Route path="/admin/contact" component={AdminInbox} />
        </Switch>
        </main>
      </div>
    </div>
  );
}

export function PermissionGate({
  me,
  need,
  children,
}: {
  me?: { permissions: string[] };
  need: string;
  children: React.ReactNode;
}) {
  if (me && !me.permissions.includes(need) && !me.permissions.includes("*")) return null;
  return <>{children}</>;
}
