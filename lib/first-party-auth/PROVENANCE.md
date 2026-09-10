# @workspace/first-party-auth provenance

## Source

| Field | Value |
|---|---|
| Template | `E:\Projects\Plug&Play` (read-only; never modified by this work) |
| Source commit | `ec593623d8675c07e36e0996459d35d4bc51398e` |
| Source package | `auth-core` (`@auth/core` 0.1.0) |
| Extraction date | 2026-09-09 |
| ClaimTagX package | `@workspace/first-party-auth` |

## Copied inventory (one-time vendor)

From `Plug&Play/auth-core/src/`:

- `index.ts`, `create-auth-platform.ts`
- `domain/*` (account, credential, session, verification, mfa, events, ids)
- `ports/*` (inbound, outbound)
- `application/*` (registration, authentication, password, mfa, session, social, anonymous, session-support)
- `adapters/*` (in-memory repos, scrypt hasher, RFC6238 TOTP, recording deliverer, DevJwt, rate limiter, fakes, Ed25519, key challenge)
- `shared/*` (Result, clock, events, ids, logger, random)
- `auth-flows.test.ts`, `anonymous-identity.test.ts`

Reference copies (rewritten into ClaimTagX adapters; not runtime-imported from Plug&Play):

- `adapters-postgres-src/postgres-account-repository.ts`
- `adapters-postgres-src/postgres-credential-repository.ts`
- `adapters-postgres-src/postgres-session-repository.ts`
- `adapters-postgres-src/postgres-verification-repository.ts`
- `adapters-postgres-src/postgres-key-challenge-store.ts`

## ClaimTagX-owned divergences

1. Package renamed `@auth/core` → `@workspace/first-party-auth` under ClaimTagX workspace conventions.
2. Production password hashing: Argon2id via `@node-rs/argon2` (Plug&Play shipped scrypt; scrypt kept as optional/test adapter only).
3. Production tokens: opaque session token service with hashed storage (not `DevJwtTokenService`).
4. Production TOTP: encrypted secret payload (not process-local Map).
5. PostgreSQL adapters + ClaimTagX-prefixed tables via additive migrations after `0020`.
6. PostgreSQL rate limiter for multi-instance API.
7. Microsoft Graph durable-job `CodeDeliverer` in API composition (never RecordingCodeDeliverer in prod).
8. No runtime path, workspace link, or package dependency back to Plug&Play.

## Dependency direction (preserved)

```
adapters → application → domain → shared
```

Hosts (api-server) inject outbound ports; core never imports ClaimTagX product modules.
