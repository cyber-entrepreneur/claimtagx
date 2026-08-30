import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import {
  BarChart3,
  Inbox,
  LogOut,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { platformFetch } from "@/lib/contactApi";
import AdminLogin from "./Login";
import AdminInbox from "./Inbox";
import InquiryWorkspace from "./InquiryWorkspace";
import AdminConfig from "./Config";
import AdminAnalytics from "./Analytics";

interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export default function AdminApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [location] = useLocation();

  useEffect(() => {
    platformFetch<Me>("/api/platform/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, [location]);

  if (loading) {
    return <div className="min-h-screen bg-obsidian text-slate grid place-items-center">Loading workspace…</div>;
  }
  if (!me) return <AdminLogin onAuthed={setMe} />;

  const nav = [
    { href: "/admin/contact", label: "Inbox", icon: Inbox },
    { href: "/admin/contact/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/admin/contact/config", label: "Configuration", icon: Settings2 },
  ];

  return (
    <div className="min-h-screen bg-obsidian text-paper flex">
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-white/10 px-4 py-6">
        <Link href="/admin/contact" className="font-extrabold text-lg mb-8">
          Claim<span className="text-lime">TagX</span>
          <span className="block text-[11px] font-medium text-slate tracking-wide mt-1">CONTACT OPS</span>
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
                  active ? "bg-white/10 text-white" : "text-slate hover:text-white"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto pt-6 text-xs text-slate">
          <p className="text-white font-medium truncate">{me.name}</p>
          <p className="truncate">{me.email}</p>
          <button
            className="mt-3 inline-flex items-center gap-1 hover:text-white"
            onClick={async () => {
              await platformFetch("/api/platform/auth/logout", { method: "POST" });
              setMe(null);
            }}
          >
            <LogOut className="w-3 h-3" /> Sign out
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="font-bold">Contact Ops</span>
          <Link href="/admin/contact" className="text-sm text-lime">Inbox</Link>
        </header>
        <Switch>
          <Route path="/admin">
            <Redirect to="/admin/contact" />
          </Route>
          <Route path="/admin/contact/analytics" component={AdminAnalytics} />
          <Route path="/admin/contact/config" component={AdminConfig} />
          <Route path="/admin/contact/:id" component={InquiryWorkspace} />
          <Route path="/admin/contact" component={AdminInbox} />
        </Switch>
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
  if (me && !me.permissions.includes(need)) return null;
  return <>{children}</>;
}
