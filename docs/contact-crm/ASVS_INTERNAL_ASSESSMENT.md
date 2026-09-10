# Contact CRM — Internal ASVS-style Assessment

**Status:** Internal engineering assessment only. **Not** an OWASP ASVS certification, audit opinion, or compliance attestation.

**Scope:** ClaimTagX Contact CRM platform API + admin UI (worktree `fwie`), assessed against ASVS-inspired control themes.  
**Evidence date:** 2026-09-03  
**Schema head:** `0023` identity finalization

Verdict vocabulary: **PASS (local)** | **PARTIAL** | **FAIL** | **BLOCKED** | **N/A**.  
**Local** = implemented and tested in this worktree. **External** = live production/IdP/scanner/SIEM evidence. Do not record Local=PASS solely by parking missing proof in Gap.

| Control theme | Local | External | Evidence (file / test) | Gap |
| --- | --- | --- | --- | --- |
| **Authentication (V2)** | **PASS (local)** | **BLOCKED** | First-party auth middleware + staff session cookie (`requirePlatformAdmin.ts`); legacy access-key login gated by `authFlags.ts`; **constant-time** session sig verify (`timingSafeEqual` in `decodeStaffSession`); **constant-time** access-key compare on legacy login path | Staging MFA/session/invite/password-reset matrix incomplete; shared access-key path is legacy/dev-gated (`authFlags`) |
| **Authorization / RBAC (V4)** | **PASS (local)** | **BLOCKED** | `rbac.ts` permission catalog; `requirePermission` on platform mutations; `routePermissions.source.test.ts`; `rbacHttp.pg.test.ts`; `rbac.matrix.test.ts`; `multiRoleHttp.pg.test.ts` | Staging first-party roles **NOT RUN** |
| **Object-level authorization** | **PASS (local)** | **N/A** | `objectAuth.ts` (`assertInquiryAccess`); wired on inquiry mutate/assign/bulk; `objectAuth.test.ts` + `objectAuth.source.test.ts` | Expand object-scope beyond suite cases as new surfaces land |
| **CSRF / CORS / CSP** | **PASS (local)** | **BLOCKED** | Exact-origin allowlist for credentialed CORS and cookie CSRF (`corsOrigin.ts`); `SameSite=lax`; cookie sessions cannot skip Origin. Double-submit CSRF token **not implemented** by design: it would not add material protection for this custom-JSON SPA (Origin checked; no cross-site form posts). Remaining threat is same-origin XSS, which a CSRF token does not stop. Staging Origin matrix **NOT RUN**. | Live Origin matrix **BLOCKED** |
| **Session management** | **PASS (local)** | **BLOCKED** | HttpOnly + `SameSite=Lax` + `secure` in production; opaque hashed tokens; **session revocation** via first-party auth tables on logout | Live revocation soak **NOT RUN** |
| **Webhooks** | **PASS (local)** | **BLOCKED** | Graph/webhook `timingSafeEqual` client-state / HMAC (`webhookSecurity.ts`, `microsoftGraph/webhookSecurity.ts`); tests green | Live Entra/Exchange webhook soak **BLOCKED** |
| **SSRF / Graph URL validation** | **PASS (local)** | **BLOCKED** | `assertSafeGraphUrl` default Microsoft hosts only; extra hosts ignored when `NODE_ENV=production`; `assertProductionSecurity` throws if `MS_GRAPH_ALLOWED_HOSTS` is set in production; notification URL rejects credentials + private/link-local hosts (`microsoftGraph/config.ts`) | Live Entra/Exchange **BLOCKED** |
| **Secrets management** | **PASS (local)** | **BLOCKED** | `assertProductionSecurity`; dual-key session (`PLATFORM_STAFF_SESSION_SECRET_PREVIOUS`) and attachment signing previous secret; production rejects `local-verify-only` and missing session secret | Live key rotation soak **BLOCKED**. Procedure: set `*_PREVIOUS`, deploy new current, remove previous after TTL |
| **Rate limiting** | **PASS (local)** | **NOT RUN** | Admin + public PG rate limits; multi-instance tests + soak profiles | Production multi-region soak **NOT RUN** |
| **Input validation** | **PASS (local)** | **N/A** | Zod on mutations; OpenAPI request/success/error schemas; Orval generated clients on ordinary admin JSON; `platformFetchAllowlist.source.test.ts` | Generated TypeScript is not runtime validation; server Zod remains the gate |
| **Output encoding / sanitization** | **PASS (local)** | **N/A** | `htmlSanitize.ts` plus stored/reflected XSS vector tests | Independent review **external**; CMS browser XSS journeys still incomplete |
| **File uploads** | **PARTIAL** | **BLOCKED** | Attachment allowlist + malware gate; multipart durable sessions; enterprise/failure tests | Live S3/Azure + live scanner credentials **BLOCKED** |
| **Signed / owned downloads** | **PASS (local)** | **NOT RUN** | Attachment signed URL HMAC (current+previous); export/DSAR download ownership + expiry | Signed download replay soak in production **NOT RUN**; FS roots must stay private |
| **PII in logs** | **PASS (local)** | **NOT RUN** | Recursive `sanitizeLogValue` (nested + arrays) plus pino-http URL query strip; tests in `asvsLocal.controls.test.ts` | SIEM shipping **NOT RUN** |
| **Audit logging** | **PASS (local)** | **NOT RUN** | Insert-only audit + marketing audit immutability; DSAR/hold/logout audited | SIEM shipping **NOT RUN** |
| **Error handling** | **PASS (local)** | **N/A** | Structured `{ error }` without stacks on platform routes; sanitizer applied to log objects | Re-check global Express stack policy per deploy |
| **Production debug** | **PASS (local)** | **NOT RUN** | Pretty logs off in production; first-party auth hard-secret checks; Graph/attachment readiness gates; `assertProductionSecurity` refuses test auth, simulators, embed worker | Confirm deploy env does not set forbidden flags |
| **Privacy / DSAR / retention** | **PASS (local)** | **BLOCKED** | Durable DSAR export job + private artifact + expiring owned download; clean bytes inlined; quarantined/pending/mismatch/missing/hold are manifest-only | Statutory compliance **BLOCKED**; live legal process **BLOCKED** |
| **Authentication test bypasses** | **PASS (local)** | **N/A** | `CRM_HTTP_TEST_AUTH` ignored in production (`isCrmHttpTestAuthAllowed`); startup throws if set in production | Headers are only honored in explicit non-prod test env |
| **Readiness / health** | **PASS (local)** | **NOT RUN** | `/livez` + `/readyz` (`platformHealth.ts`); `assertExportStoreReady()` on ready (`exportJobs.ts`, `asvsLocal.controls.test.ts`) | Production probe shipping **NOT RUN** |

## Notes

1. This mapping is a living engineering checklist for Contact CRM hardening, **not** a formal ASVS L1/L2/L3 score or certification.
2. 2026-09-03 remediations: DSAR deletion → full anonymize wipe; objection execute path; session revocation; Graph URL allowlist; CSRF Authorization+cookie tighten; PII log path expansion; confirmation live-region `role="alert"`.
3. Residual blockers: staging first-party auth matrix, live Graph, live object storage, formal ASVS review, qualified WCAG, Arabic legal review.
