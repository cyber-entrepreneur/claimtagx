# auth / adapters — IMPLEMENTER TARGET

Concrete implementations of the **outbound ports** in `../ports/outbound.ts`.
Each is swappable without touching domain or application code.

## Adapters to implement (per outbound port)

| Outbound port          | Reference adapter (dev/test)          | Production adapter (host-chosen)        |
| ---------------------- | ------------------------------------- | --------------------------------------- |
| `AccountRepository`    | in-memory                             | Postgres                                |
| `CredentialRepository` | in-memory                             | Postgres                                |
| `SessionRepository`    | in-memory                             | Postgres / Redis                        |
| `VerificationRepository`| in-memory                            | Postgres / Redis (TTL)                  |
| `PasswordHasher`       | **argon2id** (real; don't ship a stub)| argon2id / bcrypt                       |
| `TotpAuthenticator`    | RFC 6238 (real; deterministic w/ clock)| same                                   |
| `CodeDeliverer`        | recording (captures code for tests)   | Twilio (SMS) / SES (email)              |
| `TokenService`         | `DevJwt` (HS256, injected secret)     | RS256/JWKS / opaque server-side store   |
| `OAuthClient`          | fake provider (returns a fixed profile)| Google / Apple / GitHub / Microsoft    |
| `RateLimiter`          | in-memory token bucket                | Redis                                   |
| `SecureRandom`         | Node `crypto`/WebCrypto wrapper       | same                                    |

## Hard rules (QA will check)

- Implement each interface **exactly**; adapter-specific config in the constructor.
- **Password hashing and TOTP must be REAL even in the dev adapter** — unlike the
  comms-core passthrough cipher, a fake hasher would make every auth test
  meaningless. (A `DevJwt` token adapter is fine as long as it truly signs.)
- No branding, product names, or copy anywhere. TOTP `issuer`/`label` and OAuth
  provider client-ids come from constructor config, never hard-coded.

See `ARCHITECTURE-AUTH.md` and `IMPLEMENTATION-SPEC-AUTH.md`.
