# Contact CRM — Requirements Traceability Matrix

**Product:** ClaimTagX public Contact Us + Platform Contact Operations  
**Scope:** Mandatory requirement domains for a production-grade inquiry CRM  
**Baseline:** Current worktree (`lib/db` CRM schema + SQL, `artifacts/api-server` CRM modules, `artifacts/claimtagx` public form + `/admin/contact`)  
**Status vocabulary**

| Status | Meaning |
| --- | --- |
| **Implemented** | Behavior exists in code and is intended for the domain; remaining work is polish, not a missing capability. |
| **In progress** | Capability is coded or partially wired this iteration; verification, completeness, or production-safety work remains. |
| **Missing** | Required capability is absent or not wired as specified. |

This matrix does **not** claim enterprise completeness or release readiness. Status reflects code in this worktree. Release evidence lives in [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) (PASS / FAIL / BLOCKED / NOT RUN only).

**Current reconciled snapshot (2026-09-08, worktree `fwie`, branch `cursor/3b23f5cb`, source `83ca53e`, isolated PG `127.0.0.1:55470`, schema head `0020`):** THE ADVANCED CONTACT/INQUIRY CRM AND OMNICHANNEL CUSTOMER-COMMUNICATIONS PLATFORM ARE IMPLEMENTED AND LOCALLY VERIFIED WITHIN THE AUTHORIZED SCOPE. PRODUCTION DEPLOYMENT AND LIVE EXTERNAL-PROVIDER VERIFICATION REMAIN OUTSTANDING. Bounded Suites A–D and CRM **418/0/0** are accepted local evidence. Live Graph/Meta/X, Samsung Internet, formal WCAG/ASVS, and statutory GDPR/CCPA claims remain outstanding as activation or qualified-review items — not unfinished local architecture. Detail: [COMPLETION_LEDGER.md](./COMPLETION_LEDGER.md).

---

## Summary

| Domain ID | Requirement domain | Status | Target modules |
| --- | --- | --- | --- |
| CRM-PUB | Public contact form | In progress | `artifacts/claimtagx/src/pages/Contact.tsx`, `src/lib/contactApi.ts`, `src/lib/contactCatalog.ts`, `artifacts/api-server/src/routes/contact.ts`, `src/lib/crm/orchestrator.ts` |
| CRM-TYPE | Inquiry types | Implemented | `contactCatalog.ts`, `contact.ts` `SubmitBody`, `crm_inquiries.inquiry_type` |
| CRM-QUAL | Qualification | In progress | `lib/crm/qualification.ts`, `facts.ts`, `orchestrator.ts`, `crm_qualification_*` |
| CRM-ROUTE | Routing | In progress | `orchestrator.routeInquiry`, `crm_routing_rules`, `crm_teams` |
| CRM-CONV | Conversations / email threading | In progress | `lib/crm/emailThreading.ts`, `emailProvider.ts`, `lib/email.ts`, `jobs.ts`, `crm_conversations`, `crm_messages`, inbound webhook |
| CRM-SLA | SLA | In progress | `lib/crm/slaCalendar.ts`, `orchestrator` due dates, `jobs.refreshSlaStatuses`, `queue.scheduleRecurringSlaRefresh`, reply complete-on-reply in `platformContact.ts` |
| CRM-WF | Workflows / templates / macros | In progress | `crm_workflows*`, `crm_templates*`, `crm_macros`, `jobs.runWorkflows` |
| CRM-INBOX | Admin inbox / workspace | In progress | `pages/admin/Inbox.tsx`, `InquiryWorkspace.tsx`, `routes/platformContact.ts` |
| CRM-CFG | Config admin | In progress | `pages/admin/Config.tsx`, `crm_config`, `crm_taxonomy`, platform config handlers |
| CRM-AUTH | RBAC / auth | In progress | `middlewares/requirePlatformAdmin.ts`, `lib/crm/rbac.ts`, `pages/admin/Login.tsx`, `crm_staff` |
| CRM-JOBS | Durable jobs / outbox | In progress | `crm_jobs`, `lib/crm/jobs.ts`, `queue.ts`, `worker.ts`, `index.ts` embed flag |
| CRM-RL | Rate limiting | In progress | `lib/crm/rateLimit.ts`, `crm_rate_limits`, `routes/contact.ts` |
| CRM-ANL | Analytics | In progress | `crm_analytics_events`, analytics job, `pages/admin/Analytics.tsx`, platform analytics handler |
| CRM-OBS | Observability | In progress | pino HTTP, correlation IDs, `crm_audit_events`, `routes/platformHealth.ts` |
| CRM-A11Y | Accessibility (public form) | In progress | `Contact.tsx` |
| CRM-SEC | Security | In progress | CORS allowlist, honeypot, consent, webhook helpers, first-party auth middleware |
| CRM-MIG | Migrations | In progress | `lib/db/src/schema/crm.ts`, `lib/db/drizzle/0001`–`0020_*.sql`, `ROLLBACK.md` |
| CRM-TEST | Tests | In progress | `lib/crm/*.test.ts`. Current local isolated suite `tmp/crm-suite-full-closure-2.log` **418/0/0**; restore `tmp/restore-worker-recovery-closure.log` **6/0/0**; bounded Suites A–D (not combined A–E); staging/prod / load **NOT RUN** |
| CRM-GOV | Data governance | In progress | `lib/crm/governance.ts` (DSAR, anonymize, retention, legal hold), `routes/platformGovernance.ts`, `crm_consent_records`, `crm_legal_holds` |
| CRM-OAPI | OpenAPI | In progress | `lib/api-spec/openapi-contact-crm.yaml`, `openapi-contact-crm.README.md`, `orval.config.ts` (`contact-crm-*` projects) |

---

## Domain detail

### CRM-PUB — Public contact form

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Public visitor can bootstrap country/taxonomy/policy versions, submit a validated inquiry, receive a stable reference, and see qualified vs standard confirmation (including meeting URL when applicable). Idempotent retries. |
| **Current status** | **In progress** |
| **Evidence** | `GET /contact/bootstrap`, `POST /contact/inquiries` with Zod validation, honeypot, terms required, phone normalization, attribution. `submitInquiry` wraps company, contact, reference counter, inquiry / conversation / messages / answers / consent / qualification / SLA / audit **and** `crm_jobs` in `db.transaction`. Meeting generation remains after commit. Current local isolated browser evidence at source `83ca53e`: Chromium `tmp/pw-chromium-p12g.log`, Firefox `tmp/pw-firefox-p12d.log`, and WebKit `tmp/pw-webkit-p12.log` via `tmp/run-contact-e2e.ps1 -BrowserLabel <browser>` with `CRM_E2E_API`, `CRM_ADMIN_E2E=1`, `CRM_HTTP_TEST_AUTH`, `PLAYWRIGHT_SKIP_WEBSERVER=1`, PG `55432`, API `18080`, Vite `5173` -> **88 pass x 5 viewports / 0 fail / 0 skip** for each. Prior-head Playwright logs (`141/0/24`, `131/0/34`, `141/0/24`) are History only. `verify-live-contact-db.mts` **PASS** at checkpoint. Submit/outbox durability covered in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | Frontend: `Contact.tsx`, `contactApi.ts`. API: `routes/contact.ts`. Domain: `orchestrator.submitInquiry`. Persistence: `crm_contacts`, `crm_companies`, `crm_inquiries`, `crm_inquiry_answers`, `crm_consent_records`. |
| **Gap** | Browser Contact/Admin matrix is local isolated only despite Chromium/Firefox/WebKit current-head ALL_OK; staging/prod submit soak **NOT RUN**; first-party auth staging matrix **NOT RUN**; `send_acknowledgment` is workflow-driven rather than a dedicated submit outbox row; public a11y and contract gates lack release evidence (see CRM-A11Y, CRM-OAPI). G-TXN remains **FAIL**. |

### CRM-TYPE — Inquiry types

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Distinct types (`sales`, `general`, `technical`, `billing`, `other`) with type-specific questions; sales requires at least one use case. |
| **Current status** | **Implemented** |
| **Evidence** | Enum on public submit; catalog questions for sales/technical/billing; sales use-case `superRefine`. |
| **Target modules** | `contactCatalog.ts`, `SubmitBody` in `contact.ts`, `crm_inquiries.inquiry_type`, `crm_taxonomy`. |
| **Gap** | Admin taxonomy editor exists (`Config.tsx`) but is not a full catalog-governance product (draft/publish still incomplete). |

### CRM-QUAL — Qualification

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Versioned scoring model, persisted results and reasons, immediate qualification for high-intent sales, human override with audit, optional AI assist that is not the source of truth. |
| **Current status** | **In progress** |
| **Evidence** | `scoreInquiry` + published model rows; `crm_qualification_results`; override columns on inquiries; heuristic `ai_classify` job. Non-sales inquiries stay `UNASSESSED`. Config tab for models exists. Override / object-auth HTTP coverage via `objectAuth` + `rbacHttp` in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | `qualification.ts`, `facts.ts`, `ai.ts`, orchestrator scoring, platform override APIs, `InquiryWorkspace`. |
| **Gap** | Full mutation matrix beyond current suite cases incomplete; AI is heuristic only; no evaluation harness; browser auth override path **NOT RUN**. |

### CRM-ROUTE — Routing

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Ordered routing rules with conditions; team / named staff / round-robin; assignment reason; fallback if no match. |
| **Current status** | **In progress** |
| **Evidence** | `routeInquiry` walks active rules; round-robin cursor on teams; fallback to first active staff. Config routing editor exists. Cursor increment is not in the submit transaction. |
| **Target modules** | `crm_routing_rules`, `crm_teams`, `crm_team_members`, `orchestrator.routeInquiry`, `pages/admin/Config.tsx`. |
| **Gap** | Transactional round-robin; capacity / out-of-office; region-aware assignment beyond rule JSON. |

### CRM-CONV — Conversations and email threading

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | One conversation per inquiry; staff replies and system acknowledgments as messages; outbound email via Microsoft Graph with stable threading headers; inbound replies via Graph notifications + delta sync; provider failures fail the job. |
| **Current status** | **In progress** |
| **Evidence** | Conversation + message rows on submit. `microsoftGraph/*` (Entra client-credentials, sendMail, subscriptions, delta sync, encrypted delta token storage). Production webhook: `POST /contact/webhooks/microsoft-graph/mail`. Local fixture webhook retained for tests only. Effect/outbound ledger + uncertain reconciliation. Graph protocol/webhook/config simulator included in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | `microsoftGraph/*`, `emailThreading.ts`, `inboundMailbox.ts`, `emailProvider.ts`, `lib/email.ts`, `jobs.ts`, `crm_graph_mailbox_state`, `0010_crm_microsoft_graph_mailbox.sql`. |
| **Gap** | Live Entra tenant + Exchange application access policy validation **BLOCKED**. Full production notification→delta→thread e2e **NOT RUN**. G-EMAIL remains **FAIL**. |

### CRM-SLA — Service level agreements

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Versioned policies; first-response (and later next-response / resolution) instances; periodic status refresh (`ON_TRACK` / `AT_RISK` / `BREACHED`); first-response completed when staff replies. |
| **Current status** | **In progress** |
| **Evidence** | Submit creates `first_response` and optional `resolution` instances with due dates from `addBusinessMinutes` (IANA offset helper + holiday/weekend tests). Staff customer-visible reply completes first- and next-response clocks. Customer inbound re-arms `next_response`. Paused instances are skipped by `refresh_sla`. Bounded `refresh_sla` re-arm. Unit/lifecycle coverage in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0** (`slaCalendar`, `slaLifecycle`, `slaEscalation`). Live DB probes observed SLA rows on Contact submit. |
| **Target modules** | `slaCalendar.ts`, `slaLifecycle.ts`, `crm_sla_policies`, `crm_sla_instances`, `orchestrator.submitInquiry`, `jobs.refreshSlaStatuses`, reply/inbound handlers. |
| **Gap** | Live-DB scheduler soak / pause-resume production proof **NOT RUN**. Operator calendars drive due dates from policy TZ/holidays locally. G-SLA remains **FAIL**. |

### CRM-WF — Workflows, templates, macros

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Triggered workflows with conditions and idempotent executions; published template versions; macros as staff action bundles. |
| **Current status** | **In progress** |
| **Evidence** | Seeded workflows/templates; `run_workflows` job; execution idempotency key; template render; `crm_macros` table; Config editors for workflows/templates/macros. Covered under current local isolated `tmp/crm-suite-full-p12d.log` job/workflow tests. |
| **Target modules** | `crm_workflows`, `crm_workflow_executions`, `crm_templates`, `crm_template_versions`, `crm_macros`, `templates.ts`, `pages/admin/Config.tsx`. |
| **Gap** | Draft/publish/approval/rollback UX; preview; routing dry-run; macro runner completeness; dead-letter visibility for failed executions. |

### CRM-INBOX — Admin inbox and inquiry workspace

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Filterable inbox, unread/assignment, conversation timeline, reply/note/forward, status/priority/tags, qualification, meeting offer, saved views. |
| **Current status** | **In progress** |
| **Evidence** | `/admin/contact` Inbox, InquiryWorkspace, platform inquiry APIs. Login uses first-party auth; legacy access-key UI is gated to non-production flags. Keyset `nextCursor` on inquiries list; bulk assign/status return `succeeded`/`failed`; permission-aware bulk gates; duplicates endpoint; Operations dead-letter jobs UI; analytics inquiryType drill-down links. Object-scope mutate/assign/bulk + HTTP RBAC covered in current local isolated suite `tmp/crm-suite-full-p12d.log` (`objectAuth*`, `rbacHttp.pg.test.ts`). Ops fix: AdminApp `me` fetch no longer aborts on every location change. |
| **Target modules** | `Inbox.tsx`, `InquiryWorkspace.tsx`, `Analytics.tsx`, `routes/platformContact.ts`, `objectAuth.ts`, `pages/admin/Login.tsx`. |
| **Gap** | Permission-aware UI completeness beyond coded gates; local isolated admin Playwright ALL_OK on Chromium p12d; first-party auth staging matrix **NOT RUN**. Keyset client consumption + soak incomplete. Bulk partial-failure UX polish remaining. |

### CRM-CFG — Configuration admin

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Operators can manage taxonomy, qualification models, routing, SLA, templates, workflows, meeting types, policy versions, without code deploys. |
| **Current status** | **In progress** |
| **Evidence** | `Config.tsx` purpose-built editors (taxonomy, qualification, routing, workflows, SLA, meetings, tags/macros) plus platform config routes. Marketing UI now includes failed-publication reconcile panel `data-testid="marketing-publish-failures"`. Seed bootstraps defaults. Config lifecycle / publish / ledger tests included in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | `pages/admin/Config.tsx`, `crm_config`, `crm_taxonomy`, `routes/platformContact.ts` config handlers, `configLifecycle.ts`, `configPublish.ts`. |
| **Gap** | Direct PUT handlers still exist for live-publish by API clients; UI now drafts all editor saves. Live DB publish **NOT RUN**. G-CFG remains **FAIL**. |

### CRM-AUTH — RBAC and authentication

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Staff authenticate via first-party auth; `crm_staff` is the authorization source; permission checks on every platform mutation; no shared access key in production. |
| **Current status** | **In progress** |
| **Evidence** | First-party session middleware + staff resolution; role permission map; `requirePermission` with permission-denied audit. Production never enables access-key login (`authFlags.ts`). Staff invite table + POST `/platform/contact/staff/invite`. Unit RBAC matrix + **HTTP RBAC** `rbacHttp.pg.test.ts` + **objectAuth** source/unit are included in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | `requirePlatformAdmin.ts`, `authFlags.ts`, `rbac.ts`, `rbac.matrix.test.ts`, `rbacHttp.pg.test.ts`, `objectAuth.ts`, `crm_staff.auth_account_id`, `crm_staff_invites`, `pages/admin/Login.tsx`. |
| **Gap** | Legacy login module still exists for non-prod; browser admin auth matrix / staging first-party users **NOT RUN**; full object-scope coverage beyond current HTTP suite cases incomplete; session revocation soak **NOT RUN**. G-AUTH / G-RBAC remain **FAIL**. |

### CRM-JOBS — Durable jobs and transactional outbox

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Side effects (email, workflows, analytics, SLA refresh, AI) written to `crm_jobs` in the **same transaction** as the business write; dedicated worker claims with `FOR UPDATE SKIP LOCKED`; retries with backoff; dead-letter. |
| **Current status** | **In progress** |
| **Evidence** | Submit transaction inserts outbox rows (`run_workflows`, `ai_classify`, `analytics`, `notify_staff`). `claimJobs` uses `FOR UPDATE SKIP LOCKED` + lease columns; harness types excluded via `type NOT LIKE 'dual_proc_verify%'`. Dedicated process: `artifacts/api-server/src/worker.ts`, `pnpm --filter @workspace/api-server start:worker`. API embeds the worker only when `CRM_EMBED_WORKER=true` (or non-production default). Backoff and `dead` status on handler throw. `inFlightCount` overlap guard + `inFlight.source.test.ts`. Multiprocess / dual-worker cases included in current local isolated suite `tmp/crm-suite-full-p12d.log`; `tmp/dual-worker-soak1.log` PASS dual-process `SKIP LOCKED`. |
| **Target modules** | `schema/crm.ts` `crmJobsTable`, `jobs.ts`, `queue.ts`, `workerIdentity.ts`, `worker.ts`, `index.ts`. |
| **Gap** | Dual-worker lease soak is local isolated only; production multi-worker **NOT RUN**. Prefer stop live worker during multiprocess suite runs if exclusion insufficient. G-WORKER remains **FAIL**. |

### CRM-RL — Rate limiting

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Per-IP (and later per-email) limits that survive process restart and multiple API instances. |
| **Current status** | **In progress** |
| **Evidence** | Postgres `crm_rate_limits` upsert in `rateLimitOk`. Public submit uses `submit:${ip}` (env-overridable) and `submit:email:${email}`. Admin routes under `/platform` use `requireAdminRateLimit` after auth. Multi-instance counter sharing covered by `rateLimit.multiInstance.test.ts`. **Admin rate limit** `adminRateLimit.pg.test.ts` included in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | `lib/crm/rateLimit.ts`, `adminRateLimit.ts`, `adminRateLimit.pg.test.ts`, `routes/contact.ts`, `routes/platformContact.ts`. |
| **Gap** | Load-soak across many API processes incomplete (G-PERF local isolated **authorized**, production **NOT RUN**); not all platform routers may share the same middleware yet (marketing/governance/effects to unify). G-RL remains **FAIL**. |

### CRM-ANL — Analytics

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Durable events for inquiry created, qualified, replied, SLA breach, meeting booked; operator dashboard. |
| **Current status** | **In progress** |
| **Evidence** | Analytics job inserts `crm_analytics_events`. Admin `Analytics.tsx` shows totals, type/qualification/country breakdowns, SLA counts, job queue counts, canonical event counts, metric definitions, and inquiryType drill-down links. Query helpers covered in current local isolated suite `tmp/crm-suite-full-p12d.log` (`analyticsQuery`). |
| **Target modules** | `crm_analytics_events`, analytics job in `jobs.ts`, `pages/admin/Analytics.tsx`, platform analytics handler in `platformContact.ts`. |
| **Gap** | Warehouse export absent; `analytics.view` HTTP gate / live dashboard **NOT RUN**. Funnel + form_view abandonment coded. G-ANL remains **FAIL**. |

### CRM-OBS — Observability

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Structured logs, correlation ID on public and job paths, audit trail for mutations, metrics for job lag / 5xx / 429. |
| **Current status** | **In progress** |
| **Evidence** | pino-http; public `correlationId`; `crm_audit_events`. Job worker logs errors. `/livez` and `/readyz` in `platformHealth.ts`. Operations dead-letter jobs UI/replay path coded. |
| **Target modules** | `lib/logger.ts`, `audit.ts`, CRM job worker, `routes/platformHealth.ts`, Operations UI in admin. |
| **Gap** | Metrics, production dead-letter alerting, tracing across outbox → worker → Microsoft Graph; alert wiring (see G-OPS). |

### CRM-A11Y — Accessibility (public form)

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Keyboard-complete form; labeled fields; error association; focus management on submit/error; sufficient contrast; screen-reader status. |
| **Current status** | **In progress** |
| **Evidence** | `Contact.tsx`: labeled fields; error summary `role="alert"`; first-error focus; inquiry-type `aria-pressed`; reduced motion. Current local isolated automated evidence: Chromium `tmp/pw-chromium-p12g.log`, Firefox `tmp/pw-firefox-p12d.log`, and WebKit `tmp/pw-webkit-p12.log` via `tmp/run-contact-e2e.ps1 -BrowserLabel <browser>` with `CRM_E2E_API`, `CRM_ADMIN_E2E=1`, `CRM_HTTP_TEST_AUTH`, `PLAYWRIGHT_SKIP_WEBSERVER=1`, PG `55432`, API `18080`, Vite `5173` -> **88 pass x 5 viewports / 0 fail / 0 skip** for each. Prior-head `141/0/24`, `131/0/34`, `141/0/24` browser logs are History only. Slate contrast raised (`#B6C2D1`). |
| **Target modules** | `artifacts/claimtagx/src/pages/Contact.tsx`, `e2e/contact.spec.ts`. |
| **Gap** | Automated Chromium/Firefox/WebKit evidence is current-head local isolated only (`tmp/pw-chromium-p12d.log`, `tmp/pw-firefox-p12d.log`, `tmp/pw-webkit-p12.log` → **88×5 ALL_OK** each). Confirmation live-region uses `role="alert"` + assertive + heading focus. Qualified manual screen-reader and WCAG 2.2 AA sign-off **BLOCKED**. Do **not** claim WCAG PASS. G-A11Y remains **FAIL**. |

### CRM-SEC — Security

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Origin allowlist; CSRF-safe cookie policy; no secret leakage in logs; webhook authentication; input limits; PII minimization in logs. |
| **Current status** | **In progress** |
| **Evidence** | CORS credentials allowlist; JSON body 256kb; honeypot; inbound webhook helpers (timestamp window, event-id idempotency); email logs skip body; production shared-key login 410. Access-key path still exists behind flags. Security-header / webhook / object-auth source tests included in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | `app.ts`, `contact.ts` webhooks, `email.ts`, `emailThreading.ts`, `requirePlatformAdmin.ts`. |
| **Gap** | Remove shared key; harden webhook compare; PII redaction policy; internal ASVS **PASS (local)**; formal ASVS **NOT RUN**. G-SEC remains **FAIL**. |

### CRM-MIG — Migrations

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Versioned Drizzle SQL migrations for all `crm_*` tables, indexes, and uniqueness constraints; apply path in CI and production. |
| **Current status** | **In progress** |
| **Evidence** | Schema in `lib/db/src/schema/crm.ts`. Checked-in SQL through **0019** (`0017_crm_saved_views_enterprise.sql`, `0018_crm_marketing_audit_immutable.sql`), including durable jobs, email threading, ops, Graph mailbox, attachments, marketing publish job, record presence, export jobs, saved views, and immutable marketing audit. The former `0017` marketing audit migration was renamed to **0018** to avoid duplicate `0017` filenames. `ROLLBACK.md` present. Apply path: `pnpm --filter @workspace/db run migrate` / `migrate-cli`. Local verify DB target head **0019**; `migrate.ts` baseline fingerprint refreshed after head migrations, including 0019 functions; `migrationApply.deferred.test.ts` non-destructive assert >= 0019 included in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. Restore evidence: dump `tmp/claimtagx-crm-verify/dump-p12.sql` (+ schema/ledger parts), restore-functional **3 pass / 0 fail**, restore suite `tmp/crm-suite-restore-p12e.log` **338/0/0**. Historical: `dump-0014.sql` / `tmp/restore-functional-fresh3.log` **3 pass / 0 fail** is stale vs 0019. |
| **Target modules** | `lib/db/src/schema/crm.ts`, `lib/db/drizzle.config.ts`, `lib/db/drizzle/*` (`0001`–`0019`). |
| **Gap** | Staging/prod migrate apply + rollback **NOT RUN**. Restore evidence is local isolated only. G-MIG / G-RESTORE remain **FAIL**. |

### CRM-OAPI — OpenAPI

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Public and platform Contact CRM endpoints documented and generated into `lib/api-spec` / clients; request/response contracts match Zod. |
| **Current status** | **In progress** |
| **Evidence** | Standalone `lib/api-spec/openapi-contact-crm.yaml`. Orval `contact-generated` client + schemas. `CONTACT_CRM_OPERATIONS` is path/method metadata only. Public `contactApi.ts` uses generated `getContactBootstrap` / `submitContactInquiry` via `customFetch`. OpenAPI contract / Orval drift tests present in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | `lib/api-spec/openapi-contact-crm.yaml`, `orval.config.ts`, `routes/contact.ts`, `routes/platformContact.ts`, `routes/platformGovernance.ts`. |
| **Gap** | Ordinary admin JSON uses Orval + `platformCall`; CSV/export download remain reviewed manual transport. Release drift CI incomplete. G-OAPI remains **FAIL**. |

### CRM-TEST — Tests

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Unit tests for qualification/templates/conditions; integration tests for transactional submit + outbox; worker SKIP LOCKED; RBAC matrix; inbound threading; SLA transitions; public a11y. |
| **Current status** | **In progress** |
| **Evidence** | Unit/integration under `lib/crm/*.test.ts` incl. marketing, attachments, Graph simulator, `exportJobs.pg.test.ts`, `rbacHttp.pg.test.ts`, `adminRateLimit.pg.test.ts`, `dsarExecution.pg.test.ts`, `objectAuth*.test.ts`, `inFlight.source.test.ts`, multiprocess dual-worker. Current local isolated full suite: `tmp/crm-suite-full-p12d.log`, command `node --import tsx --test src/lib/crm/*.test.ts` with `DATABASE_URL` on verify DB `55432` and `CRM_ALLOW_TEST_JOBS=true` -> **338 pass / 0 fail / 0 skip**. Restore DB suite: `tmp/crm-suite-restore-p12e.log` -> **338 pass / 0 fail / 0 skip**. Dual-worker: `tmp/dual-worker-soak1.log` PASS dual-process `SKIP LOCKED`. Historical suite8: `tmp/crm-suite-full8.log` -> **251 tests / 249 pass / 0 fail / 2 skip** (2026-09-02, pre skip-remediation). Typecheck/build **PASS** at checkpoint (2026-09-02). Browser current-head local isolated: Chromium `tmp/pw-chromium-p12g.log`, Firefox `tmp/pw-firefox-p12d.log`, WebKit `tmp/pw-webkit-p12.log` -> **88 pass x 5 viewports / 0 fail / 0 skip** with `CRM_ADMIN_E2E=1`. Prior-head browser 141/0/24, 131/0/34, 141/0/24 -> History. |
| **Target modules** | `artifacts/api-server/src/lib/crm/*.test.ts`, `artifacts/claimtagx/e2e/contact.spec.ts`. |
| **Gap** | Current CRM, restore, dual-worker, and browser evidence is local isolated only. Contract CI, qualified a11y, staging pyramid, and **non-functional** production load (G-PERF: local isolated **authorized**, production **NOT RUN**) remain open. Local evidence is **not** production release PASS evidence. G-TEST remains **FAIL**. |

### CRM-GOV — Data governance

| Item | Detail |
| --- | --- |
| **Mandatory outcomes** | Consent capture with policy versions, IP/UA; retention/deletion process; export for subject-access; lawful basis documented; staff access least-privilege. |
| **Current status** | **In progress** |
| **Evidence** | Consent rows on submit. `governance.ts` / `dsar.ts`: field classification, role redaction, `exportDsarPackage`, `anonymizeContact`, `enforceInquiryRetention`, DSAR correct/delete execution. Routes: `POST /platform/contact/governance/dsar-export`, correct/delete, `/anonymize`, `/retention-run` (`platformGovernance.ts`). Duplicate effects route was removed from `platformGovernance`, leaving the effects handler under `platformEffects`. `dsarExecution.pg.test.ts` + `dsarAttachmentExport.pg.test.ts` included in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0**. |
| **Target modules** | `lib/crm/governance.ts`, `lib/crm/dsar.ts`, `dsarExecution.pg.test.ts`, `routes/platformGovernance.ts`, `crm_consent_records`, `crm_contacts`, `crm_audit_events`. |
| **Gap** | Live DSAR / legal process **NOT RUN**; legal hold completeness; scheduled retention worker; restore drill; DPA-aligned logging. Do **not** claim GDPR/enterprise-complete. G-GOV remains **FAIL**. |

---

## Cross-cutting notes

1. **Coded ≠ verified.** Durability, OpenAPI, threading, governance, analytics, SLA calendar, config UX, and public a11y landed as code this iteration. Release gates remain FAIL / BLOCKED / NOT RUN until evidence exists.
2. **Schema vs apply.** Versioned SQL through **0019** is checked in; local 0019 restore is evidenced, and `migrate.ts` baseline fingerprint was refreshed after head migrations. Staging/prod migrate + rollback are not evidenced.
3. **Auth dual-path.** First-party auth is the intended production path; shared access key remains behind non-prod flags.
4. **Email.** Microsoft Graph hard-fails in production when misconfigured; threading headers persist. Live tenant outbound→inbound e2e is not run.
5. **Meetings.** External scheduling URL + optional scheduling webhook; no first-party calendar.
6. **Suite8 is historical local CRM evidence (pre skip-remediation).** Current local isolated p12 suite is **338/0/0**; suite6/suite7 belong in PRODUCTION_READINESS History only.

See [ADR-001-architecture.md](./ADR-001-architecture.md) for decisions, [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for ordered delivery, and [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) for release gates.
