import { lazy, Suspense } from "react";
import { LegacyAccessKeyLogin, type Me } from "./loginShared";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const allowLegacyKey =
  import.meta.env.DEV === true &&
  import.meta.env.PROD !== true &&
  import.meta.env.VITE_ALLOW_ACCESS_KEY_LOGIN === "true";

const ClerkLogin = lazy(() => import("./ClerkLogin"));

export default function AdminLogin({ onAuthed }: { onAuthed: (me: Me) => void }) {
  if (!clerkPubKey) {
    return (
      <div className="min-h-screen bg-obsidian text-paper grid place-items-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold">Platform Admin</h1>
          <p className="text-sm text-ink">
            VITE_CLERK_PUBLISHABLE_KEY is required for Contact Ops authentication.
            {allowLegacyKey
              ? " Development access-key login is enabled."
              : " Set the publishable key, or enable VITE_ALLOW_ACCESS_KEY_LOGIN=true for local non-Clerk testing."}
          </p>
          {allowLegacyKey ? <LegacyAccessKeyLogin onAuthed={onAuthed} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian text-paper grid place-items-center px-4 py-10">
      <Suspense fallback={<p className="text-ink">Loading identity provider…</p>}>
        <ClerkLogin publishableKey={clerkPubKey} onAuthed={onAuthed} />
      </Suspense>
    </div>
  );
}
