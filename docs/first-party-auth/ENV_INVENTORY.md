# First-party auth — environment variable inventory

Source-verified environment variables that the first-party auth path reads. Every
name below is grepped from the actual code (no invented/unused names). Grouped by
where the value must be set. Names are read via `process.env.<NAME>` in the API
server / worker (`artifacts/api-server/src/**`).

> Deliberately NOT set: `AUTH_DELIVERY_ENCRYPTION_KEY`. It is mentioned only in a
> design comment in `lib/auth/composeAuthPlatform.ts` as a rejected alternative
> (the code deliverer sends auth mail directly via Graph and never persists the
> plaintext code), so it is intentionally omitted here.
>
> Fully removed: hosted identity-provider variables. They are no longer read
> anywhere; the identity-provider gate fails the build if a hosted-provider boot
> requirement returns.

## Railway — API server (`dist/index.mjs`)

Required in production:

| Variable | Source | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `lib/db`, many `*.pg.test.ts`, `isolatedCrmDatabase.ts` | Postgres connection (Drizzle). Backs all auth + CRM tables. |
| `AUTH_MFA_ENCRYPTION_KEY` | `lib/auth/composeAuthPlatform.ts` | 32-byte key (base64/base64url/hex) for AES-256-GCM TOTP secret sealing. **Throws in production if missing.** |
| `MS_GRAPH_TENANT_ID` | `lib/crm/graphConfig`, `email.ts` | Microsoft Graph app tenant (transactional + auth mail). |
| `MS_GRAPH_CLIENT_ID` | `lib/crm/graphConfig` | Graph app client id. |
| `MS_GRAPH_CLIENT_SECRET` *or* `MS_GRAPH_CLIENT_CERTIFICATE` (+ `MS_GRAPH_CLIENT_CERTIFICATE_THUMBPRINT`) | `lib/crm/graphConfig` | Graph app credential (secret or cert). |

Optional / tunable (secure defaults in code):

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_ARGON2_MEMORY_KIB` | `19456` | Argon2id memory cost (KiB). |
| `AUTH_ARGON2_TIME_COST` | `2` | Argon2id iterations. |
| `AUTH_ARGON2_PARALLELISM` | `1` | Argon2id lanes. |
| `PLATFORM_ADMIN_EMAILS` | *(empty)* | Comma-separated allow-list gating who may become CRM staff. Empty + prod requires a pending invite. |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Comma-separated credentialed origins (CORS + cookie CSRF allow-list). |
| `TRUST_PROXY_HOPS` | `0` (off) | Express `trust proxy` hop count behind Railway/CDN. |
| `MS_GRAPH_MAILBOX_UPN` | `exchange-mailbox` | Sending mailbox UPN. |
| `MS_GRAPH_ALLOWED_HOSTS` | *(empty in prod)* | Graph egress host allow-list. |
| `NODE_ENV` | — | `production` enables Secure/SameSite=None cookies and hard secret checks. |
| `LISTEN_HOST` | `lib/crm/listenHost.ts` | Required in production; bind address for the HTTP server. |
| `PUBLIC_SITE_URL` | `composeAuthPlatform.ts`, invite email | Optional API-side alias for public site origin (deep links). Prefer setting this on the API if `VITE_SITE_URL` is not available at runtime. |
| `CRM_EMBED_WORKER` | `index.ts` | Prefer `false` on the API service when a dedicated worker process runs; `true` embeds the worker loop in the API process. |
| `CRM_TURNSTILE_SITE_KEY` | `botAdapter.ts` | Cloudflare Turnstile site key (contact form bot proof). Required in production. |
| `CRM_TURNSTILE_SECRET_KEY` | `botAdapter.ts` | Turnstile secret. Required in production. **API-only — never on Cloudflare Pages.** |
| `CRM_TURNSTILE_EXPECTED_HOSTNAMES` | `botAdapter.ts` | Comma-separated hostnames Turnstile must return. Required in production. |
| `CRM_TURNSTILE_EXPECTED_ACTION` | `botAdapter.ts` | Default `contact_submit`. |
| `LOG_LEVEL` | `info` | Pino level. |

Recommended production boundary:

- Public site / SPA origin: `https://claimtagx.com`
- API origin: `https://api.claimtagx.com`

Set `CORS_ALLOWED_ORIGINS=https://claimtagx.com,https://api.claimtagx.com`
on the API for credentialed browser calls and cookie-CSRF origin checks. The
session cookie is always named `ctx_auth_session`, is `HttpOnly`, and uses
`Path=/`. In production (`NODE_ENV=production`) it is emitted as
`Secure; SameSite=None` so `https://claimtagx.com` can send it to
`https://api.claimtagx.com` on cross-site XHR/fetch requests.

Temporary Railway domains such as `*.up.railway.app` are useful for smoke
testing, but they are not the intended durable browser boundary. Keep
`NODE_ENV=production` there so cookies remain `Secure; SameSite=None`; browsers
will only send them over HTTPS, and every temporary frontend/API origin that
needs credentialed requests must be listed exactly in `CORS_ALLOWED_ORIGINS`.
For local non-production HTTP (`NODE_ENV` not `production`), the API relaxes the
cookie to `SameSite=Lax` and `Secure=false` for loopback development only.

Non-production only (must be OFF/absent in production):

| Variable | Purpose |
| --- | --- |
| `CRM_HTTP_TEST_AUTH` | Enables the `x-crm-test-staff-id` bypass in `requirePlatformAdmin` and the `POST /platform/auth/test-login` endpoint. `requirePlatformAdmin` throws if `true` in production. |
| `ENABLE_DEMO_VENUES` | Exposes demo venue invite tokens on `/me/venues/available`. |

## Cloudflare (Pages / front-ends)

Public build-time variables only (no secrets):

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Absolute API origin used by SPA fetch clients. |
| `VITE_SITE_URL` | Public site origin used to build password-reset / invite deep links in auth emails (also readable as `PUBLIC_SITE_URL` on the API). |

No auth secret belongs on Cloudflare. The SPA(s) call the API cross-site and
rely on the `ctx_auth_session` cookie. The relevant server-side knob is
`CORS_ALLOWED_ORIGINS` (set on the API) which must include the deployed
Cloudflare origin(s) so credentialed requests are allowed.

`REPLIT_DEV_DOMAIN` / `REPLIT_DEPLOYMENT_DOMAIN` (read by `corsOrigin.ts` and
`email.ts`) are auto-populated origins used to build the CORS allow-list and the
Handler app base URL; set explicitly only if not running on Replit.

## Railway — background worker (`dist/worker.mjs`)

The worker shares the same code/env as the API. Auth-relevant:

| Variable | Source | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `worker.ts` → `lib/db` | Same Postgres as the API. |
| `MS_GRAPH_*` | `email.ts` | Sending auth/transactional mail from queued effects. |
| `CRM_EMBED_WORKER` | `index.ts` | When `true`, the API process also runs the worker loop (single-process deploys). |
| `CRM_WORKER_EXIT_ON_SHUTDOWN` | `worker.ts` | Forced to `true` by the standalone worker entrypoint. |

(Other `CRM_WORKER_*` / `CRM_JOB_*` tuning knobs exist but are queue mechanics,
not auth.)

## Postgres

No auth env vars are set on Postgres itself; the database is reached via
`DATABASE_URL`. The auth schema (`auth_*` tables + `crm_staff.auth_account_id`)
is created by migrations `0021` through `0023`.

## Optional (used only if present)

| Variable | Source | Purpose |
| --- | --- | --- |
| `HANDLER_APP_URL` | `email.ts`, `tamperAlerts.ts` | Absolute base URL for Handler links in emails. |
| `TAMPER_ALERT_THRESHOLD` / `TAMPER_ALERT_WINDOW_MS` / `TAMPER_ALERT_COOLDOWN_MS` | `tamperAlerts.ts` | Owner tamper-spike alert tuning (owner emails now resolved from first-party accounts). |
