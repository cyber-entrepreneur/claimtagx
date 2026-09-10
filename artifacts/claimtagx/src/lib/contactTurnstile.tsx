import { useEffect, useRef } from "react";

type Props = {
  siteKey: string;
  action: string;
  onToken: (token: string) => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

export function TurnstileField({ siteKey, action, onToken }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || typeof window === "undefined") return;
    let cancelled = false;
    const existing = document.querySelector('script[data-claimtagx-turnstile="1"]') as HTMLScriptElement | null;
    const start = () => {
      if (cancelled || !ref.current || !window.turnstile) return;
      window.turnstile.render(ref.current, {
        sitekey: siteKey,
        action,
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };
    if (window.turnstile) {
      start();
      return () => {
        cancelled = true;
      };
    }
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset.claimtagxTurnstile = "1";
      document.head.appendChild(script);
    }
    script.addEventListener("load", start);
    return () => {
      cancelled = true;
      script.removeEventListener("load", start);
    };
  }, [siteKey, action, onToken]);
  return <div ref={ref} className="mt-3" />;
}
