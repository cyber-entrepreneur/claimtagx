# ClaimTagX first-party auth — extraction / integration map

**Worktree:** `E:\Projects\claimtagx-website\.codex-worktrees\first-party-auth`  
**Branch:** `codex/first-party-auth`  
**Base commit:** `71c945e89b3ac6b77b46aeb7f0b917d315ced852`  
**Plug&Play source (read-only):** `E:\Projects\Plug&Play` @ `ec593623d8675c07e36e0996459d35d4bc51398e`

## Decision (user-approved)

- Remove the hosted identity provider completely. No SaaS IdP replacement.
- Vendor Plug&Play `@auth/core` once into ClaimTagX-owned `@workspace/first-party-auth`.
- ClaimTagX owns accounts, credentials, sessions, MFA, audit; CRM RBAC stays authorization-only.
- Compose auth inside Railway API; worker stays separate (`CRM_EMBED_WORKER=false`).
- Deliver auth email via Microsoft Graph durable jobs (not Resend / RecordingCodeDeliverer in prod).

## Source → ClaimTagX map

| Plug&Play source | ClaimTagX destination | Notes |
|---|---|---|
| `auth-core/src/**` | `lib/first-party-auth/src/**` | Rename `@auth/core` → `@workspace/first-party-auth` |
| `server/.../postgres-*-repository.ts` | `lib/first-party-auth/src/adapters/postgres/*` + ClaimTagX schema | Rewritten for ClaimTagX drizzle + table prefixes |
| auth tables in Plug&Play drizzle | `lib/db/drizzle/0021_*.sql` onward | Additive; never rewrite ≤0020 |
| — | `artifacts/api-server` composition + `/platform/auth/*` | Cookie sessions, CRM staff link |
| — | `artifacts/claimtagx` + `handler-app` UI | Replace hosted-provider screens |

## ClaimTagX divergences (required)

1. **Argon2id** (`@node-rs/argon2`) instead of shipped scrypt — keep scrypt verifier only if legacy hashes appear in tests; prod hasher is Argon2id.
2. **Opaque hashed session tokens** instead of `DevJwtTokenService` in production composition.
3. **Encrypted TOTP secrets** in credential payload (AES-GCM) — no process-local Map.
4. **PostgreSQL rate limiter** for multi-instance API.
5. **Graph `CodeDeliverer`** enqueueing durable effects (token never logged).
6. **Identity link:** `crm_staff.auth_account_id` (additive), finalized by `0023`.
7. **Cookies:** `HttpOnly` + host-only + `Secure` (prod) + `SameSite=Lax`; document `api.claimtagx.com` preference and schemeful same-site with the SPA.
8. Ignore Plug&Play hosted-IdP recommendations.

## Integration seams

| Concern | Existing ClaimTagX | After |
|---|---|---|
| Who is this? | Hosted-IdP JWT / HMAC legacy session | First-party session cookie + account id |
| What may they do? | `rbac.ts` / `objectAuth.ts` | Unchanged |
| Staff row | Legacy external id | `auth_account_id` |
| Handler | Legacy opaque `handler_user_id` | First-party account id (same identity system) |
| Invites | DB-only CRM invite | Activation email via Graph + accept endpoint |
| Email | Graph durable jobs | Auth purposes added as effect kinds |

## Not copied

comms/messaging, pay/credits/ledger, admin-web, intercom, Plug&Play railway deploy, Redis-less rate limiter as prod default, `RecordingCodeDeliverer` / `DevJwtTokenService` in production wiring.

## Hosted-IdP removal targets

Runtime hosted-IdP dependencies/imports, old login screens, bearer-scheme names,
public build variables, tests asserting hosted-provider behavior, and runbook
deploy steps requiring hosted-provider setup. Gate: fail CI if runtime
hosted-IdP deps/imports/env reappear.
