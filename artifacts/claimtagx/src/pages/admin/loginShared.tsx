import { useState } from "react";
import { platformLogin } from "@/lib/contactApi";

export type Me = {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
};

export function LegacyAccessKeyLogin({ onAuthed }: { onAuthed: (me: Me) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="w-full max-w-sm space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        try {
          const me = await platformLogin(
            String(form.get("email")),
            String(form.get("accessKey")),
            String(form.get("name") || ""),
          );
          onAuthed(me as Me);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sign-in failed");
        } finally {
          setPending(false);
        }
      }}
    >
      <p className="text-xs text-amber-200">Development-only access-key login. Disabled in production.</p>
      <label className="block text-xs text-ink" htmlFor="admin-name">
        Name
      </label>
      <input
        id="admin-name"
        name="name"
        placeholder="Name"
        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2"
      />
      <label className="block text-xs text-ink" htmlFor="admin-email">
        Work email
      </label>
      <input
        id="admin-email"
        name="email"
        type="email"
        required
        placeholder="Work email"
        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2"
      />
      <label className="block text-xs text-ink" htmlFor="admin-key">
        Staff access key
      </label>
      <input
        id="admin-key"
        name="accessKey"
        type="password"
        required
        placeholder="Staff access key"
        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2"
      />
      {error && (
        <p className="text-red-300 text-sm" role="alert">
          {error}
        </p>
      )}
      <button disabled={pending} className="w-full bg-lime text-obsidian rounded-lg py-2.5 font-semibold">
        {pending ? "Signing in…" : "Continue with access key"}
      </button>
    </form>
  );
}
