# auth / application — IMPLEMENTER TARGET

Flow services that **implement the inbound ports** in `../ports/inbound.ts`,
expressed purely via the domain model and the **outbound ports** in
`../ports/outbound.ts`. No infrastructure constructed here; all deps arrive
through a `*Deps` constructor object.

## Services to implement (one class per inbound port)

| Class (suggested)          | Implements            | Core responsibility |
| -------------------------- | --------------------- | ------------------- |
| `RegistrationServiceImpl`  | `RegistrationService` | register w/ password, issue + confirm identifier verification. |
| `AuthenticationServiceImpl`| `AuthenticationService` | password login, OTP login, MFA step-up → `LoginOutcome`. |
| `SocialServiceImpl`        | `SocialService`       | OAuth begin/complete, link-or-create account by subject. |
| `PasswordServiceImpl`      | `PasswordService`     | reset (via code) + authenticated change. |
| `MfaServiceImpl`           | `MfaService`          | TOTP enroll/confirm, recovery codes, disable. |
| `SessionServiceImpl`       | `SessionService`      | verify/refresh/revoke; `verify` is what downstream services call. |

## Hard rules (QA will check)

- Depend only on `../domain` and `../ports`. **No** `../adapters` import, no
  `Date.now()`, no `Math.random()` (use `SecureRandom`), no `crypto`/`fetch`/`fs`.
- Return `AuthResult<T>` for every expected failure using the closed
  `AuthErrorCode` set; map infrastructure exceptions to an `AuthError`.
- **Never** hold plaintext secrets: passwords go straight to `PasswordHasher`;
  codes are generated via `SecureRandom`, hashed for storage, and delivered once
  via `CodeDeliverer`. Domain events carry ids only — never codes/tokens/secrets.
- Enforce lockout/throttling via `RateLimiter` on login, OTP request, and reset.
- Uniform-failure discipline: `loginWithPassword` returns `INVALID_CREDENTIALS`
  for both unknown-account and wrong-password (no user enumeration).

See `ARCHITECTURE-AUTH.md` and `IMPLEMENTATION-SPEC-AUTH.md` for flow steps and
acceptance criteria.
