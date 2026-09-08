# CSRF threat analysis (Contact CRM platform cookie)

**Decision:** Do **not** add a double-submit CSRF token. Local status is PASS for Origin + SameSite design, not an independent ASVS certification.

## Threat
Cross-site browsers triggering cookie-authenticated `POST/PUT/PATCH/DELETE` against `/api/platform/*`.

## Mitigations in place
1. **Exact Origin allowlist** (`corsOrigin.ts` / `isCredentialedOriginAllowed`). Cookie-backed platform mutations reject missing or non-allowlisted `Origin`.
2. **SameSite=Lax** session cookie. Cross-site POST from a foreign site does not include the cookie in modern browsers.
3. **No HTML form posts** to platform JSON APIs. Clients send `application/json`.
4. **Bearer-only** requests (Authorization header, no session cookie) skip cookie CSRF by design; they are not cookie CSRF.
5. **Production CORS** does not wildcard loopback.

## Cases considered
| Case | Outcome |
| --- | --- |
| Foreign site POST with cookies | SameSite=Lax omits cookie; Origin check would still fail |
| Request without Origin | Cookie session mutations rejected |
| Subdomain confusion | Only configured origins, not `*.claimtagx.com` wildcard |
| Legacy browsers ignoring SameSite | Origin check remains |
| XSS on allowlisted origin | CSRF token **does not help**; XSS can read any token |
| GET navigation with Lax cookie | Platform mutations are not GET |

## Why a CSRF token is not added
A synchronized token would be ceremony against a threat already covered for this SPA, and would not reduce same-origin XSS. Implementing it without a remaining cookie-CSRF gap would add client/session complexity without a defined extra threat.

Staging Origin matrix remains **NOT RUN**. Independent ASVS review remains **BLOCKED**.
