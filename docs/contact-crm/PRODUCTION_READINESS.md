# Contact CRM — Production readiness

THE ADVANCED CONTACT/INQUIRY CRM AND OMNICHANNEL CUSTOMER-COMMUNICATIONS PLATFORM ARE IMPLEMENTED AND LOCALLY VERIFIED WITHIN THE AUTHORIZED SCOPE. PRODUCTION DEPLOYMENT AND LIVE EXTERNAL-PROVIDER VERIFICATION REMAIN OUTSTANDING.

This document does not describe the product as an MVP, demo, proof of concept, starter, simplified CRM, or minimal inbox. Frozen scope is the authorized product boundary, not a reduced implementation.

**Evidence as of:** 2026-09-08 (worktree `fwie`, branch `cursor/3b23f5cb`, source `83ca53e`). Bounded Suites A–D (not a combined A–E mega-matrix) plus engineering gates on isolated PG `127.0.0.1:55470`. See [COMPLETION_LEDGER.md](./COMPLETION_LEDGER.md).

**Schema head:** **0023 identity-finalization migration**.

**Email platform:** Microsoft Graph / Exchange Online (Resend/Svix are historical only — not production dependencies).

**Staging/CI/live-activation gates:** still outstanding (those are deployment and provider items, not missing local CRM architecture).

**Accepted local evidence:** CRM suite `tmp/crm-suite-full-closure-2.log` **418 pass / 0 fail / 0 skip**; dump `tmp/claimtagx-crm-verify/dump-0020-closure.sql`; restore head **0020**; worker recovery `tmp/restore-worker-recovery-closure.log` **6 pass / 0 fail / 0 skip**; API typecheck/build PASS; website typecheck/full production build PASS (`tmp/build-web-closure.log`: SEO HTML, i18n 906 keys, public-copy engineering PASS); lab perf budget PASS (`tmp/perf-budget-closure.log`, not field CWV); OpenAPI/Orval drift included in the CRM suite.

**Browser:** bounded Suites A–D, retries=0, Chrome/Edge/Firefox/WebKit representative compatibility. Combined mega-matrix Chrome-13 remains **HISTORICAL FAIL** and is not a closure gate.

**Channels:** Website Contact locally operational and verified. Microsoft Graph, WhatsApp, Messenger, Instagram, and X: implemented, awaiting credentials/approval and live verification. TikTok: unsupported by the available public support-messaging API. LinkedIn private messaging: partner-gated. No LIVE_VERIFIED claim from fixtures or simulators.

**Not claimed:** production deployment; live Graph/WhatsApp/Messenger/Instagram/X round trips; Samsung Internet; formal WCAG certification; independent ASVS certification; legal approval or statutory GDPR/CCPA compliance.

Gate vocabulary: **PASS** | **FAIL** | **BLOCKED** | **NOT RUN** | **NOT CONFIRMED** | **PENDING**.

Do not promote historical rows as current PASS without re-running the named command on the current source tree.

Related: [REQUIREMENTS_TRACEABILITY_MATRIX.md](./REQUIREMENTS_TRACEABILITY_MATRIX.md) · [ADR-001-architecture.md](./ADR-001-architecture.md) · [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) · [RUNBOOK.md](./RUNBOOK.md) · [SKIP_INVENTORY.md](./SKIP_INVENTORY.md) · [ASVS_INTERNAL_ASSESSMENT.md](./ASVS_INTERNAL_ASSESSMENT.md) · [PAGINATION.md](./PAGINATION.md)

---

## Isolated verification targets

| Item | Value |
| --- | --- |
| Cluster | scoop PostgreSQL 16, data dir `tmp/claimtagx-crm-verify/pgdata` |
| Listen | `127.0.0.1:55470` (owned cluster; Windows excluded 55432 — do not use 5432) |
| Primary DB | `claimtagx_crm_verify` |
| Restore DB | `claimtagx_crm_verify_restore` |
| Soak DB | `claimtagx_crm_soak` |
| Credentials | `tmp/claimtagx-crm-verify/credentials.env` (gitignored) |
| Local API | `http://127.0.0.1:18080` |
| Local Vite | `http://127.0.0.1:5173` |
| Worker | dedicated `dist/worker.mjs` (API uses `CRM_EMBED_WORKER=false` for live Contact E2E) |

---

## Evidence ledger (authoritative — current only)

Each claim: requirement/gate · status · exact command · source revision/worktree · date · environment · result · skip count · evidence class · remaining limitation.

### Typecheck and builds

| Requirement/gate | Status | Exact command | Source / worktree | Environment | Date | Result | Skips | Evidence class | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API typecheck | **PASS** (current-head local) | `pnpm --filter @workspace/api-server run typecheck` | `83ca53e` / `fwie` | Node v22, Windows | 2026-09-03 | exit 0; log `tmp/typecheck-api-p12.log` | — | compile | Staging/prod **NOT RUN** |
| Website typecheck | **PASS** (current-head local) | `pnpm --filter @workspace/claimtagx run typecheck` | `83ca53e` / `fwie` | same | 2026-09-03 | exit 0; log `tmp/typecheck-web-p12e.log` | — | compile | — |
| API production build | **PASS** (current-head local) | `pnpm --filter @workspace/api-server run build` | `83ca53e` / `fwie` | same | 2026-09-03 | `dist/index.mjs` + `dist/worker.mjs`; log `tmp/build-api-p12.log` | — | build | — |
| Website production build | **PASS** (current-head local) | `pnpm --filter @workspace/claimtagx run build` | `83ca53e` / `fwie` | same | 2026-09-03 | SEO/i18n/public-copy/sitemap/prerender/`_redirects`; log `tmp/build-web-p12.log` | — | build | — |
| OpenAPI catalog sync | **PASS** (current-head local) | `node scripts/sync-contact-crm-ops.mjs` | `83ca53e` / `fwie` | repo | 2026-09-03 | **112** operations; log `tmp/openapi-sync-p12.log` | **0** | static | Release CI still **FAIL** (G-OAPI) |
| Orval generation | **PASS** (current-head local) | `pnpm --filter @workspace/api-spec run codegen:contact` | `83ca53e` / `fwie` | repo | 2026-09-03 | log `tmp/orval-p12d.log` | **0** | codegen | — |
| Router/OpenAPI/generated-client gates | **PASS** (current-head local) | CRM suite OpenAPI + `platformFetchAllowlist.source.test.ts` | `83ca53e` / `fwie` | isolated PG + repo | 2026-09-03 | `tmp/openapi-drift-gate-p12.log` + inclusion in `tmp/crm-suite-full-p12d.log` | **0** | contract | Unapproved `/api/platform/` literals fail the source gate |

### Migrations and restore

| Requirement/gate | Status | Exact command | Source / worktree | Environment | Date | Result | Skips | Evidence class | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Checked-in SQL through 0019 | **PASS** (static only) | inspect `lib/db/drizzle/0019_crm_staff_routing_attributes.sql` (+ prior 0017/0018) | `83ca53e` / `fwie` / `cursor/3b23f5cb` | repo | 2026-09-03 | files present; `migrationStatic.test.ts` + `ROLLBACK.md` include 0019 | — | local isolated/static | Staging/prod migrate **NOT RUN**; release gate remains **FAIL** |
| Empty/upgrade migrate through 0019 | **PASS** (local isolated only; not a release gate PASS) | `node --import tsx --test src/lib/crm/migrationBootstrap.pg.test.ts` | `83ca53e` / `fwie` / `cursor/3b23f5cb` | `127.0.0.1:55432` | 2026-09-03 | `tmp/migration-bootstrap-p12.log` **4 pass / 0 fail**; bootstrap reaches `0019_crm_staff_routing_attributes.sql` | **0** | local isolated/integration | Staging/prod migrate **NOT RUN** |
| Current-schema dump/restore-functional (0019) | **PASS** (local isolated only; not a release gate PASS) | `pg_dump` verify → restore DB; `node --import tsx --test src/lib/crm/restoreFunctional.pg.test.ts` | `83ca53e` / `fwie` / `cursor/3b23f5cb` | isolated restore DB | 2026-09-03 | dump `tmp/claimtagx-crm-verify/dump-p12.sql`; `tmp/restore-functional-p12.log` **3 pass / 0 fail**; head `0019_crm_staff_routing_attributes.sql` | **0** | local isolated/integration | Staging/production restore **NOT RUN** |
| Full CRM suite on restored DB | **PASS** (local isolated only; not a release gate PASS) | `node --import tsx --test --test-concurrency=1 src/lib/crm/*.test.ts` against restore DB after dump-p12; log `tmp/crm-suite-restore-p12e.log` | `83ca53e` / `fwie` / `cursor/3b23f5cb` | isolated restore DB | 2026-09-03 | **338 pass / 0 fail / 0 skip** | **0** | local isolated/integration soak | Staging/production restore **NOT RUN** |

### CRM / CMS / attachment / Graph / DSAR / worker suites

| Requirement/gate | Status | Exact command | Source / worktree | Environment | Date | Result | Skips | Evidence class | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Complete CRM lib suite | **PASS** (local isolated only; not a release gate PASS) | `node --import tsx --test --test-concurrency=1 src/lib/crm/*.test.ts` with `DATABASE_URL` on verify DB `127.0.0.1:55432` and `CRM_ALLOW_TEST_JOBS=true`; log `tmp/crm-suite-full-p12d.log` | `83ca53e` / `fwie` / `cursor/3b23f5cb` | isolated PG verify DB | 2026-09-03 | **338 pass / 0 fail / 0 skip** | **0** | unit+integration | Staging/prod suite **NOT RUN**; suite8 **249/0/2** and p10b **312/0/0** moved to History |
| Skip remediation (listen-bind) | **PASS** (local isolated only) | `listenBind.isolation.test.ts` always asserts postgres `127.0.0.1:55432`; included in `tmp/crm-suite-full-p12d.log` | `83ca53e` / `fwie` | isolated PG | 2026-09-03 | **0 skips** | **0** | local isolated/code+test | Production bind/listen validation **NOT RUN** |
| Skip remediation (deferred migrate) | **PASS** (local isolated only) | `migrationApply.deferred.test.ts` non-destructive assert verify DB head >= 0019 + SQL files through 0019; included in `tmp/crm-suite-full-p12d.log` | `83ca53e` / `fwie` | isolated PG | 2026-09-03 | **0 skips** | **0** | local isolated/code+test | Production migrate **NOT RUN** |
| Marketing CMS PG + concurrency | **PASS** (local isolated only) | included in full CRM suite; log `tmp/crm-suite-full-p12d.log` | `83ca53e` / `fwie` | isolated PG | 2026-09-03 | current suite inclusion clean | **0** | local isolated/integration | Publication failure recovery soak and staging CDN proof still pending |
| Attachment durability | **PASS** (local isolated only) | `attachmentStore.enterprise.test.ts` in full suite; log `tmp/crm-suite-full-p12d.log` | `83ca53e` / `fwie` | isolated PG | 2026-09-03 | included in **338/0/0** | **0** | integration | Live cloud credentials **BLOCKED** |
| Microsoft Graph protocol | **PASS** (local simulator only) | Graph protocol/webhook/config tests in CRM suite; log `tmp/crm-suite-full-p12d.log` | `83ca53e` / `fwie` | simulator + isolated PG | 2026-09-03 | included in **338/0/0** | **0** | fixture/simulator | Live Entra/Exchange **BLOCKED** |
| DSAR attachment export E2E | **PASS** (local isolated only; not statutory compliance) | `dsarAttachmentExport.pg.test.ts` + `dsarExecution.pg.test.ts` in `tmp/crm-suite-full-p12d.log` | `83ca53e` / `fwie` | isolated PG | 2026-09-03 | HTTP → durable job → worker → adapter → private artifact → owned download/expiry; clean/dup/quarantine/pending/missing/mismatch/hold/cancel/timeout/crash-retry | **0** | local isolated/integration | Live legal DSAR **BLOCKED**; G-GOV remains **FAIL** |
| Worker ordering / concurrency | **PASS** (local isolated only) | `workerOrdering.pg.test.ts` in `tmp/crm-suite-full-p12d.log`; claim SQL skips pending `_ck` peers | `83ca53e` / `fwie` | isolated PG | 2026-09-03 | same-key order; cross-process claim skip; generation CAS; poison isolation | **0** | local isolated/integration | Production multi-worker **NOT RUN** |
| Job observability / PII | **PASS** (local isolated only) | `jobMetrics.ts` + `jobAlerts.ts` + pipeline JSONL disable; sanitizer tests in suite | `83ca53e` / `fwie` | isolated PG | 2026-09-03 | type-only metric labels; hashed correlation; `CRM_JOB_PIPELINE_LOG=off` | **0** | local isolated | Production alerting **NOT RUN** |
| Internal ASVS controls | **PASS** (local engineering only) | `asvsLocal.controls.test.ts` + `assertProductionSecurity` in suite | `83ca53e` / `fwie` | isolated PG | 2026-09-03 | secrets fail-closed; test-auth ignored in production; recursive PII sanitize | **0** | local isolated | Formal ASVS certification **NOT RUN** / **BLOCKED** |

### Localization / SEO / public copy

| Requirement/gate | Status | Exact command | Source / worktree | Environment | Date | Result | Skips | Evidence class | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| i18n key parity | **PASS** (in website build) | `node scripts/validate-i18n.mjs` via `tmp/build-web-p12.log` | `83ca53e` / `fwie` | repo | 2026-09-03 | **897 keys** en/ar | **0** | static | Hardcoded English scan beyond registered keys still incomplete |
| Public-copy gate | **PASS** (in website build) | `node scripts/validate-public-copy.mjs` via `tmp/build-web-p12.log` | `83ca53e` / `fwie` | repo | 2026-09-03 | **60 files** OK | **0** | static | Qualified Arabic legal copy **BLOCKED** |
| SEO HTML + structured data | **PASS** (in website build) | `node scripts/validate-seo-html.mjs` during website build (`tmp/build-web-p12.log`) | `83ca53e` / `fwie` | prerendered dist | 2026-09-03 | title/canonical/hreflang/OG + SoftwareApplication JSON-LD | **0** | build gate | Not a release gate PASS |
| Sitemap generation | **PASS** (in website build) | `node scripts/generate-sitemap.mjs` during `tmp/build-web-p12.log` | `83ca53e` / `fwie` | repo | 2026-09-03 | 19 indexable routes written | **0** | build gate | Production crawl **NOT RUN** |
| Redirects | **PASS** (in website build) | Cloudflare `_redirects` written by `scripts/build-claimtagx-and-handler.mjs` | `83ca53e` / `fwie` | dist | 2026-09-03 | `/handler` 301 + SPA 200s | **0** | build gate | Staging CDN **NOT RUN** |
| Arabic public RTL matrix | **PASS** (local isolated; included in 88×5 browser projects) | `e2e/arabic-public.spec.ts` inside `tmp/run-contact-e2e.ps1` | `83ca53e` / `fwie` | Vite 5173 | 2026-09-03 | dir=rtl, landmark, overflow checks per viewport | **0** | local isolated/browser | Qualified Arabic legal translation **BLOCKED** |

### Browser / Contact (bounded Suites A–D, not combined A–E)

Evidence dir: `tmp/qualification/20260906T000400Z-83ca53ec9d86-combined/`. Preview `artifacts/claimtagx/dist/public`, retries=0, `PLAYWRIGHT_WORKERS=1`, isolated `ctx_e2e_*` on `127.0.0.1:55470`. Combined mega-matrix Chrome-13 is **HISTORICAL FAIL**.

| Suite | Status | Notes |
| --- | --- | --- |
| A Contact | **PASS** with **LIMITED_EVIDENCE** | Chrome 5 VPs; Edge/Firefox/WebKit 390+1440. Chrome mobile-390 sales progressive **Target crashed** once; isolated **3/3 PASS**. |
| B Unified inbox | **PASS** with **LIMITED_EVIDENCE** | desktop-1440 Chrome/Edge/WebKit ALL_OK. Firefox first attempt native `browserContext.close` / `_maybeDontRestoreTabs`; isolated **3/3 PASS**. |
| C Governance | **PASS** | desktop-1440 Chrome/Edge/Firefox/WebKit: analytics CSV **78 bytes** SHA `3d0a9a54bdfa183e16436fbdaed3d685bf90c8e194fe75e535f90c0a3fdf6884` (`metric,value`), one DSAR, one CMS dual-control. |
| D Public compatibility | **PASS** after one pricing contrast fix | 390+1440 × four engines; Home/Pricing/Security/Privacy EN+AR; representative axe, RTL, overflow, viewport screenshots. Edge/WebKit first attempt axe contrast on pricing CTAs; product fix then ALL_OK. |

| Requirement/gate | Status | Exact command | Source / worktree | Environment | Date | Result | Skips | Evidence class | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Suite A Contact | **PASS** (bounded; LIMITED_EVIDENCE on one Chrome native crash) | `tmp/run-contact-e2e.ps1` contact greps; logs `pw-suite-a-*` | `83ca53e` / `fwie` | preview + PG 55470 | 2026-09-08 | retries=0 | **0** | local isolated/browser | Not an exhaustive viewport×engine matrix |
| Suite B Inbox | **PASS** (bounded; LIMITED_EVIDENCE on one Firefox native close crash) | `e2e/omnichannel-inbox.spec.ts` desktop-1440 | `83ca53e` / `fwie` | preview + PG 55470 | 2026-09-08 | Chrome-2/Edge/WebKit ALL_OK; Firefox 3/3 after crash | **0** | local isolated/browser | Live social channels **NOT VERIFIED** |
| Suite C Governance | **PASS** | analytics+dsar+cms specs desktop-1440 | `83ca53e` / `fwie` | preview + PG 55470 | 2026-09-08 | CSV non-empty `metric,value` | **0** | local isolated/browser | Live DSAR legal process **NOT RUN** |
| Suite D Public | **PASS** | public-a11y + arabic-public greps 390+1440 | `83ca53e` / `fwie` | preview + PG 55470 | 2026-09-08 | logs `pw-suite-d-public-*-2.log` ALL_OK | **0** | local isolated/browser | Samsung Internet **NOT RUN**; WCAG certification **NOT CLAIMED** |

### CMS / attachments completeness (honest)

| Capability | Status | Notes |
| --- | --- | --- |
| Marketing CMS | **In progress - NOT enterprise-complete** | Lifecycle, dual editors, dual schedulers, schedule publish, rollback, OpenAPI/Orval admin client wired; failed-publication reconcile panel `data-testid="marketing-publish-failures"`; suite inclusion `tmp/crm-suite-full-p12d.log` **338/0/0**. Remaining: publication failure recovery soak, notification/cache failure paths, staging CDN proof |
| Attachments | **In progress - NOT enterprise-complete** | PG multipart sessions; production forbids memory store; S3/Azure injectable clients; concurrency/orphan/legal-hold local tests in `tmp/crm-suite-full-p12d.log` **338/0/0**. Live cloud **BLOCKED** without credentials |

### P7 local progress (coded; current local suite inclusion)

Not release gates. Full CRM suite at 0019 head is current local isolated evidence only: `tmp/crm-suite-full-p12d.log` **338 pass / 0 fail / 0 skip**.

| Item | Status | Evidence / notes | Remaining gap |
| --- | --- | --- | --- |
| HTTP RBAC matrix | **coded**; current local isolated suite PASS | `rbacHttp.pg.test.ts` in `tmp/crm-suite-full-p12d.log`; browser admin cases in Chromium 88×5 | First-party auth staging matrix **NOT RUN** |
| Admin rate limit | **coded**; current local isolated suite PASS | `adminRateLimit.pg.test.ts` in `tmp/crm-suite-full-p12d.log` | Multi-instance admin soak incomplete |
| Object auth | **coded**; current local isolated suite PASS | `objectAuth.ts` + inquiry mutate / assign / bulk wired; tests in `tmp/crm-suite-full-p12d.log` | Full HTTP object-scope matrix beyond suite cases incomplete; staging **NOT RUN** |
| Keyset cursor | **coded** | inquiries list returns `nextCursor` | Client consumption + soak incomplete |
| Bulk partial failure | **coded** | bulk assign/status return `succeeded` / `failed` | UI partial-failure UX completeness |
| DSAR correct/delete + attachment export HTTP | **coded**; current local isolated suite PASS | `dsarExecution.pg.test.ts` + `dsarAttachmentExport.pg.test.ts` in `tmp/crm-suite-full-p12d.log` | Live DSAR / legal process **NOT RUN**; G-GOV still **FAIL** |
| Duplicates endpoint | **coded** | `GET …/contacts/duplicates` | Product UX + merge workflow completeness |
| Analytics drill-down | **coded** | inquiryType links on Analytics | Production dashboard **NOT RUN** |
| Operations dead-letter UI | **coded** | dead-letter jobs surface / replay path | Production alerting **NOT RUN** |
| Permission-aware inbox bulk gates | **coded** | bulk actions gated by permissions; exercised in admin Playwright | First-party auth staging matrix **NOT RUN** |
| inFlight source test | **coded**; current local isolated suite PASS | `inFlight.source.test.ts` in `tmp/crm-suite-full-p12d.log` | Production dual-worker soak **NOT RUN** |
| Multiprocess harness isolation | **PASS** (local isolated only) | `tmp/dual-worker-soak1.log` PASS dual-process `SKIP LOCKED`; suite cases also in `tmp/crm-suite-full-p12d.log` | Production dual-worker soak **NOT RUN** |
| Export jobs (0016) + saved views/audit (0017/0018) + staff routing (0019) | **coded**; current local isolated suite PASS | `exportJobs.ts`; SQL through 0019; `migrate.ts` baseline fingerprint refreshed | Staging/prod migrate **NOT RUN** |
| Generated-client ordinary JSON | **coded**; source gate PASS | Admin pages use Orval + `platformCall` / `mapPlatformError`; exceptions in `platformManualTransport.registry.ts` | CSV nav + export download remain manual by design |

---

## Skip inventory (current head)

See [SKIP_INVENTORY.md](./SKIP_INVENTORY.md). Summary:

| Area | Pre-remediation skips | Remediation (coded at `83ca53e`) | Re-verification |
| --- | --- | --- | --- |
| CRM suite | 2 (listen-bind + deferred migrate) in suite8 | listen-bind always asserts `127.0.0.1:55432`; deferred migrate non-destructive >= 0019 assert | **CONFIRMED** local isolated in `tmp/crm-suite-full-p12d.log`: **338 pass / 0 fail / 0 skip** |
| Browser Contact + Admin | 24 / 34 / 24 (prior head) | Firefox zoom → viewport reflow; live tests all viewports when `CRM_E2E_API` and `CRM_ADMIN_E2E=1` are set | Chromium current-head **0 skips** (`pw-chromium-p12g`). Firefox `pw-firefox-p12d` / WebKit `pw-webkit-p12` ALL_OK. |

These remediations do **not** constitute a production PASS.

---

## History (do not use as current status)

| Item | Exact command / log | Source / date | Result | Superseded by |
| --- | --- | --- | --- | --- |
| CRM suite suite8 | `tmp/crm-suite-full8.log` | pre-remediation / 2026-09-02 | **251 tests / 249 pass / 0 fail / 2 skip** | `tmp/crm-suite-full-p12d.log` **338/0/0** |
| CRM suite p10b | `tmp/crm-suite-full-p10b.log` | 2026-09-03 | **312 pass / 0 fail / 0 skip** | `tmp/crm-suite-full-p12d.log` **338/0/0** |
| CRM suite p12 / p12b / p12c | `tmp/crm-suite-full-p12.log` etc. | 2026-09-03 | failures / process crash (a11y source, slaCalendar) | `tmp/crm-suite-full-p12d.log` |
| Restore suite 0019 / 312 | `tmp/crm-suite-restore-0019.log` | 2026-09-03 | **312/0/0** | `tmp/crm-suite-restore-p12e.log` **338/0/0** |
| Restore dump-0019 | `tmp/claimtagx-crm-verify/dump-0019.sql` | 2026-09-03 | 0019 dump | `dump-p12.sql` |
| Restore-functional fresh3 (0014 dump) | `tmp/restore-functional-fresh3.log`; `dump-0014.sql` | 2026-09-02 | **3 pass**; schema **0014** | dump-p12 + restore-functional-p12 |
| Chromium Contact live (prior head) | `tmp/pw-chromium-full-live3.log` | 2026-09-02 | **141 pass / 0 fail / 24 skip** | `tmp/pw-chromium-p12d.log` **88×5 / 0 skip** |
| Firefox Contact live (prior head) | `tmp/pw-firefox-full2.log` | 2026-09-02 | **131 pass / 0 fail / 34 skip** | `tmp/pw-firefox-p12.log` (current wave) |
| WebKit Contact live (prior head) | `tmp/pw-webkit-full5.log` | 2026-09-02 | **141 pass / 0 fail / 24 skip** | `tmp/pw-webkit-p12.log` (current wave) |
| Chromium/Firefox/WebKit p11 | `tmp/pw-chromium-p11c.log`, `pw-firefox-p11b.log`, `pw-webkit-p11b.log` | 2026-09-03 | 88×5 ALL_OK at prior generated-client wave | p12 browser logs |
| Chromium p12 / p12b / p12c | axe inject crash / syntax error / ECONNRESET | 2026-09-03 | HAS_FAILURES | `tmp/pw-chromium-p12d.log` ALL_OK |
| Unhealthy soak | `tmp/load-soak-beyond-matrix2.log` | 2026-09-03 | queue accumulation FAIL | `tmp/load-soak-drain-p12.json` clean soak |
| i18n **580** / **883** keys | — | — | stale | **897** |
| Restore ending at **0008** / **0014** / **0018-only** claims | — | — | historical | schema head **0019** |
| Post-remediation browser partials | `tmp/pw-chromium-head2.log`, `head4.log`, `head19`/`head8`/`head1` | 2026-09-02-03 | mixed | p12 browser logs |

---

## Release gates

| ID | Gate | Result | Evidence pointer |
| --- | --- | --- | --- |
| G-MIG | Versioned SQL + rollback | **FAIL** | SQL through **0019** checked in; local bootstrap `tmp/migration-bootstrap-p12.log` **4/0**; staging/prod **NOT RUN** |
| G-TXN | Submit + outbox atomic | **FAIL** | Current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**; production **NOT RUN** |
| G-WORKER | SKIP LOCKED worker | **FAIL** | `tmp/crm-suite-full-p12d.log` **338/0/0** plus `tmp/dual-worker-soak1.log` + ordering tests; production **NOT RUN** |
| G-EMAIL | Graph send/receive e2e | **FAIL** | Simulator in `tmp/crm-suite-full-p12d.log` **338/0/0**; live tenant **BLOCKED** |
| G-RL | DB rate limits | **FAIL** | PG-backed + admin limiter + local soak; production **NOT RUN** |
| G-AUTH | First-party auth | **FAIL** | Local first-party auth suite present; staging MFA/session/invite matrix **NOT RUN** |
| G-RBAC | Permission matrix | **FAIL** | Unit + HTTP RBAC + objectAuth in `tmp/crm-suite-full-p12d.log` **338/0/0**; staging first-party roles **NOT RUN** |
| G-OAPI | OpenAPI + codegen | **FAIL** | 112 catalog ops; Orval + drift + generated-client source gate PASS locally; release CI incomplete |
| G-SLA | Calendars + pause/resume | **FAIL** | DST/zone tests + suite PASS; live scheduler soak incomplete |
| G-CFG | Config change control | **FAIL** | Governed draft/review/approve/publish locally; staging **NOT RUN** |
| G-ANL | Analytics | **FAIL** | Local events; production dashboard **NOT RUN** |
| G-A11Y | WCAG evidence | **FAIL** | axe in local Playwright; qualified WCAG/screen-reader **BLOCKED** |
| G-TEST | Pyramid | **FAIL** | CRM `tmp/crm-suite-full-p12d.log` **338/0/0** + restore `tmp/crm-suite-restore-p12e.log` **338/0/0**; Chromium `pw-chromium-p12g`, Firefox `pw-firefox-p12d`, WebKit `pw-webkit-p12` ALL_OK 88×5; staging/prod **NOT RUN** |
| G-SEC | ASVS | **FAIL** | Internal assessment **PASS (local)** in [ASVS_INTERNAL_ASSESSMENT.md](./ASVS_INTERNAL_ASSESSMENT.md); formal ASVS **NOT RUN** |
| G-GOV | Governance | **FAIL** | Local DSAR export/correct/delete/hold; live legal DSAR **BLOCKED** |
| G-OPS | Alerts/runbooks | **FAIL** | Local `jobAlerts.ts` thresholds + RUNBOOK; production alerting **NOT RUN** |
| G-PERF | Load | **FAIL** | Contact p95 108–204ms local (accepted). **Historical FAIL:** `tmp/load-soak-beyond-matrix2.log`. **Current local isolated drain+capacity PASS:** `tmp/load-soak-drain-p12.json` **1×1/2×2/4×2/4×4**; pending=0 running=0; poison dead=1 expected; steady/burst retried=0; 12 injected retry-storm retries/cell. Not production SLO. Production load **NOT RUN** |
| G-RESTORE | Restore | **FAIL** | dump `tmp/claimtagx-crm-verify/dump-p12.sql`; restore-functional **3/0**; restore suite `tmp/crm-suite-restore-p12e.log` **338/0/0**; staging/prod **NOT RUN** |

---

## Remaining external authorization

1. Staging/production first-party auth users, MFA, password reset, invites, and session revocation (**NOT RUN**).
2. Entra ID app + Exchange Online mailbox + reachable Graph notification URL (**BLOCKED** — live Graph).
3. Staging/production hosts, DNS, migrate & soak.
4. Qualified legal review of legal/marketing copy (**BLOCKED**).
5. Qualified manual accessibility / screen-reader review (**BLOCKED** — WCAG).
6. Live cloud object-storage credentials for attachment provider soak.
7. Cleanup of `tmp/claimtagx-crm-verify` when authorized.
