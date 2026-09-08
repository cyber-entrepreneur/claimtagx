import { useEffect, useState, type ReactNode } from "react";
import { ClerkProvider, SignIn, useAuth, useUser } from "@clerk/react";
import { fetchPlatformMe, setPlatformAuthTokenGetter } from "@/lib/contactApi";
import { LegacyAccessKeyLogin, type Me } from "./loginShared";

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;
const allowLegacyKey =
  import.meta.env.DEV === true &&
  import.meta.env.PROD !== true &&
  import.meta.env.VITE_ALLOW_ACCESS_KEY_LOGIN === "true";

function ClerkSessionBridge({ onAuthed }: { onAuthed: (me: Me) => void }) {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !user) return;
    setPlatformAuthTokenGetter(async () => (await getToken()) ?? null);
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchPlatformMe();
        if (!cancelled) onAuthed(me);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Your identity is signed in but not authorized for Contact Ops.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      setPlatformAuthTokenGetter(null);
    };
  }, [isSignedIn, user, getToken, onAuthed]);

  if (error) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-bold">Access restricted</h1>
        <p className="text-sm text-ink">{error}</p>
        <p className="text-xs text-ink">
          Ask an owner to add your work email to PLATFORM_ADMIN_EMAILS and provision crm_staff.
        </p>
      </div>
    );
  }

  return <p className="text-ink">Completing sign-in…</p>;
}

function SignedOut({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return null;
  return <>{children}</>;
}

function SignedIn({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return null;
  return <>{children}</>;
}

export default function ClerkLogin({
  publishableKey,
  onAuthed,
}: {
  publishableKey: string;
  onAuthed: (me: Me) => void;
}) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      {...(clerkProxyUrl ? { proxyUrl: clerkProxyUrl } : {})}
      appearance={{
        variables: {
          colorPrimary: "#C6F24E",
          colorBackground: "#0B0F19",
          colorText: "#F8FAFC",
        },
      }}
    >
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Platform Admin</h1>
          <p className="text-sm text-ink mt-1">
            Sign in with your ClaimTagX identity provider to access Contact Ops.
          </p>
        </div>
        <SignedOut>
          <SignIn routing="hash" />
          {allowLegacyKey ? (
            <div className="pt-6 border-t border-white/10">
              <LegacyAccessKeyLogin onAuthed={onAuthed} />
            </div>
          ) : null}
        </SignedOut>
        <SignedIn>
          <ClerkSessionBridge onAuthed={onAuthed} />
        </SignedIn>
      </div>
    </ClerkProvider>
  );
}
