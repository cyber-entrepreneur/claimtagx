/** Bind-address policy for the Contact CRM API. Isolated verification must stay on loopback. */

export function resolveListenHost(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.LISTEN_HOST?.trim();
  if (explicit) return explicit;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "LISTEN_HOST is required in production. Set 127.0.0.1 when a reverse proxy is on the same host, or the intended interface. Binding 0.0.0.0 must be an explicit deployment choice.",
    );
  }
  return "127.0.0.1";
}

export function isWildcardBind(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}
