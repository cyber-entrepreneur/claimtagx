import { useState } from "react";
import { platformLogin } from "@/lib/contactApi";

export default function AdminLogin({
  onAuthed,
}: {
  onAuthed: (me: { id: string; email: string; name: string; role: string; permissions: string[] }) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="min-h-screen bg-obsidian text-paper grid place-items-center px-4">
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
            onAuthed(me as never);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Sign-in failed");
          } finally {
            setPending(false);
          }
        }}
      >
        <h1 className="text-2xl font-bold">Platform Admin</h1>
        <p className="text-sm text-slate">Contact Us inbox and inquiry operations.</p>
        <input name="name" placeholder="Name" className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" />
        <input name="email" type="email" required placeholder="Work email" className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" />
        <input name="accessKey" type="password" required placeholder="Staff access key" className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" />
        {error && <p className="text-red-300 text-sm">{error}</p>}
        <button disabled={pending} className="w-full bg-lime text-obsidian rounded-lg py-2.5 font-semibold">
          {pending ? "Signing in…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
