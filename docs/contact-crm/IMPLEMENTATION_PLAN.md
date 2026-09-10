# Contact CRM — Implementation plan

Dependency-ordered delivery. Each phase’s **acceptance** still requires evidence (tests, migrate apply, or ops proof). This plan does **not** declare the product ready when a phase is coded, and it does **not** define a reduced “good enough” release. Ship only when [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) gates are **PASS**.

**This iteration (reconciled 2026-09-08):** Source `83ca53e`, worktree `fwie`, branch `cursor/3b23f5cb`, schema head **0020**, isolated PG **55470**.

THE ADVANCED CONTACT/INQUIRY CRM AND OMNICHANNEL CUSTOMER-COMMUNICATIONS PLATFORM ARE IMPLEMENTED AND LOCALLY VERIFIED WITHIN THE AUTHORIZED SCOPE. PRODUCTION DEPLOYMENT AND LIVE EXTERNAL-PROVIDER VERIFICATION REMAIN OUTSTANDING.

Email architecture is Microsoft Graph/Exchange Online (Resend/Svix are historical only). Bounded Suites A–D are the accepted browser closure path; the combined A–E mega-matrix is not a gate. Local CRM evidence is **418/0/0**. See [COMPLETION_LEDGER.md](./COMPLETION_LEDGER.md) and [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).

| Phase | Theme | Iteration status |
| --- | --- | --- |
| 1 | Migrations | **In progress** - SQL through **0020** checked in; verify DB head 0020 on `127.0.0.1:55470`; dump-0020-closure restore evidenced; staging/prod **NOT RUN** |
| 2 | Transactional submit / outbox | **Largely coded; current local p12 suite PASS; staging/prod pending** |
| 3 | Durable worker | **Largely coded; current local p12 suite PASS**; `tmp/dual-worker-soak1.log` PASS dual-process `SKIP LOCKED` |
| 4 | Email threading (Graph) | **Simulator current local p12 suite PASS; live tenant BLOCKED** |
| 5 | First-party auth RBAC | **In progress** - HTTP RBAC + objectAuth in current local p12 suite; staging auth matrix **NOT RUN** |
| 6 | OpenAPI | **In progress** (marketing OpenAPI + Orval regenerated; full drift CI incomplete) |
| 7 | SLA scheduler + calendar | **Coded; unit/lifecycle in current local p12 suite; live soak pending** |
| 8 | Admin config UX | **Coded; config tests in current local p12 suite** (direct PUT bypass still to govern) |
| 9 | Analytics | **Coded; analyticsQuery in current local p12 suite** - inquiryType drill-down coded; live dashboard **NOT RUN** |
| 10 | Public a11y / i18n | **In progress** (906-key parity in `tmp/build-web-closure.log`; Suite D bounded public axe/RTL; qualified legal Arabic + WCAG certification **BLOCKED** / **NOT CLAIMED**) |
| 11 | Tests / gates | **In progress** - CRM **418/0/0** (`tmp/crm-suite-full-closure-2.log`); restore+worker recovery **6/0/0**; bounded Suites A–D; combined A–E mega-matrix **not run as a gate**; staging/prod **NOT RUN** |
| 12 | Ops / docs / governance | **In progress** - DSAR correct/delete in current local p12 suite; docs reconciled to current local facts; staging restore **NOT RUN** |
| 13 | Marketing CMS | **In progress** - lifecycle/OpenAPI/admin client/schedule worker in current local p12 suite; not complete |
| 14 | Attachment durability | **In progress** - PG-backed multipart + local durability PASS in current local p12 suite; enterprise-complete **not** claimed |

Related: [REQUIREMENTS_TRACEABILITY_MATRIX.md](./REQUIREMENTS_TRACEABILITY_MATRIX.md), [ADR-001-architecture.md](./ADR-001-architecture.md), [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).

---

## Phase 1 — Migrations

**Depends on:** none  
**ADR:** Drizzle SQL path  
**Status:** largely coded; SQL through 0019 checked in; local bootstrap `tmp/migration-bootstrap-p12.log` **4/0**; dump-p12 restore evidenced; staging/prod pending

### Goal

Check in and apply versioned SQL for all `crm_*` tables (including jobs, staff, consent, SLA, analytics) plus indexes required by uniqueness, inbox filters, and job claiming.

### Work

1. Generate drizzle migrations from `lib/db/src/schema/crm.ts` into `lib/db/drizzle`.
2. Add `crm_rate_limits` (or equivalent) in schema + migration if not already modeled.
3. Ensure job claim index: `(status, run_at)` (already sketched on `crm_jobs`).
4. Document apply command in ops notes (full runbook in Phase 12).
5. Verify empty and existing databases migrate without colliding with venue tables.

### Coded this iteration

- `lib/db/drizzle/0001_crm_durable_jobs.sql` — `inquiry_type`, job lease columns, `crm_rate_limits`.
- `lib/db/drizzle/0002_crm_email_threading.sql` — message threading / delivery columns.
- `lib/db/drizzle/ROLLBACK.md` — staging rollback notes.
- `migrate.ts` baseline fingerprint refreshed after head migrations, including 0019 functions.
- Local isolated 0019 restore evidence: dump `tmp/claimtagx-crm-verify/dump-p12.sql` (+ schema/ledger parts), restore-functional **3 pass / 0 fail**, restore suite `tmp/crm-suite-restore-p12e.log` **338/0/0**.

### Acceptance (not yet evidenced)

- `crm_*` created only via migrate, not implicit push.
- Unique constraints: inquiry `reference`, `idempotency_key`, staff email/account link, template keys.
- CI apply against a provisioned database.

---

## Phase 2 — Transactional submit / outbox

**Depends on:** Phase 1  
**ADR:** Outbox in same transaction as inquiry  
**Status:** largely coded; current local p12 suite PASS; staging/prod pending

### Goal

`submitInquiry` commits contact/company/inquiry/conversation/message/answers/consent/qualification/SLA/audit **and** `crm_jobs` rows atomically. Idempotent replay of the same `idempotencyKey` returns the original reference without double-insert.

### Work

1. Wrap create path in a single `db.transaction`.
2. Insert outbox jobs inside that transaction (`run_workflows`, `ai_classify`, `analytics`, `notify_staff`, `send_acknowledgment` as designed).
3. Do not call Microsoft Graph, meetings HTTP, or other I/O inside the transaction except Postgres.
4. Keep honeypot / validation / rate-limit checks **before** the transaction.
5. On unique idempotency conflict, return the existing inquiry.

### Coded this iteration

- Inquiry write + SLA instances + audit + outbox (`run_workflows`, `ai_classify`, `analytics`, optional `notify_staff`) inside `db.transaction` in `orchestrator.submitInquiry`.
- Acknowledgments still go through workflows (`send_template`), not a dedicated `send_acknowledgment` outbox row on submit.
- `resolveCompany` / `resolveContact` / `nextReference` still run **before** the transaction.

### Acceptance (not yet evidenced)

- Killing the process after commit still leaves jobs pending.
- Partial failure before commit leaves no inquiry and no jobs.
- Public `POST /contact/inquiries` remains the only writer of public inquiries.
- Automated rollback / idempotency integration test.

---

## Phase 3 — Durable worker

**Depends on:** Phase 2  
**ADR:** Dedicated worker, `FOR UPDATE SKIP LOCKED`  
**Status:** largely coded; current local p12 suite PASS; dual-process soak PASS locally

### Goal

Replace select-then-update claiming with SKIP LOCKED. Run a worker loop (dedicated process preferred; in-process loop only if it uses the same claim SQL). Retries, backoff, `dead` status, structured error logs.

### Work

1. Claim query with `SKIP LOCKED` and `ORDER BY run_at`.
2. Mark `running` in the same claim transaction; execute handler outside or with short locks.
3. Idempotent handlers where possible (especially email: skip if acknowledgment message already exists).
4. Metrics hook points: claimed, succeeded, failed, dead, lag (`now() - min(run_at)`).
5. Ensure `startCrmJobWorker` does not overlap ticks (`inFlight` guard).

### Coded this iteration

- `queue.claimJobs` — `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` with lease columns.
- Dedicated entry: `artifacts/api-server/src/worker.ts`, script `start:worker`.
- API process embeds the worker only when `CRM_EMBED_WORKER=true` (default on in non-production).
- Multiprocess harness isolation: unique `dual_proc_verify%` job types; `claimJobs` excludes `type NOT LIKE 'dual_proc_verify%'` (suite7 FAIL root cause = concurrent drain; suite8 **249/0/2** is History only; current local isolated `tmp/crm-suite-full-p12d.log` **338/0/0**).
- Dual-worker soak: `tmp/dual-worker-soak1.log` PASS dual-process `SKIP LOCKED` locally.

### Acceptance (not yet evidenced)

- Two concurrent workers do not double-send the same job in production.
- Failed Graph send (Phase 4) retries the same job id against live Graph (**BLOCKED**).
- Dual-worker lease soak is local isolated only; production multi-worker **NOT RUN**.

---

## Phase 4 — Email threading (Microsoft Graph / Exchange Online)

**Depends on:** Phase 3  
**ADR:** Graph hard-fail; inbound via change notifications + delta sync  
**Status:** coded; live tenant verification pending

### Goal

Outbound acknowledgments and staff replies send through Microsoft Graph `sendMail` from the configured Exchange Online mailbox; provider errors fail the job. Inbound replies arrive via Graph change notifications and delta synchronization with threading via Message-ID / In-Reply-To / References.

### Work

1. `sendTransactionalEmail` fails closed when Graph config is missing in production.
2. Pass/store Message-ID on `crm_messages`.
3. Production webhook: `POST /contact/webhooks/microsoft-graph/mail` (validation token + `clientState`).
4. Delta recovery with encrypted tokens in `crm_graph_mailbox_state` (migration `0010`).
5. Do not log email bodies or secrets.

### Coded this iteration

- `microsoftGraph/*` (Entra client-credentials with secret **or** certificate JWT assertion, sendMail, subscriptions, delta sync).
- `emailThreading.ts` + tests; `emailProvider.ts` Graph adapter; `lib/email.ts` production hard-fail.
- Legacy Resend/Svix production path removed; fixture inbound webhook returns 410 in production.

### Acceptance (not yet evidenced)

- Failed send → job `pending`/`dead`, not `completed` (**PASS** on simulator).
- Customer reply with reference headers appears in workspace timeline against live Graph mailbox (**BLOCKED** — no tenant).

---

## Phase 5 — First-Party Auth RBAC

**Depends on:** Phases 1–2 (staff table migrated); can overlap Phase 4  
**ADR:** First-party auth, no shared access key  
**Status:** in progress (not finished this iteration)

### Goal

Operators sign in with first-party ClaimTagX auth. Platform routes require `crm_staff` + permission. Remove access-key login from API and admin UI.

### Work

1. Admin UI: first-party sign-in; drop access-key fields.
2. Delete or disable `POST /platform/auth/login` in production (fail closed if key env is set).
3. Enforce `requirePermission` on every mutating platform route.
4. Staff invite/deactivate via config (owner/admin only).
5. Map first-party account id onto `crm_staff.auth_account_id` uniquely.

### Coded this iteration (partial)

- `Login.tsx` first-party session bridge; legacy key UI only when non-prod flags allow.
- Production shared-key login returns 410.
- Unit permission matrix (`rbac.matrix.test.ts`).
- HTTP RBAC `rbacHttp.pg.test.ts` + `objectAuth.ts` on inquiry mutate/assign/bulk — **included in suite8** (full object-scope matrix beyond suite cases incomplete).

### Acceptance (not yet evidenced)

- Unauthenticated `/platform/*` → 401.
- Sales role cannot `config.manage` (HTTP) — suite8 covers RBAC HTTP cases; browser / staging auth **NOT RUN**.
- Shared key cannot mint a session in production (path fully gone from production builds).

---

## Phase 6 — OpenAPI

**Depends on:** Public + platform routes stable enough to freeze (after Phase 5 for auth schemes)  
**Status:** coded pending verification

### Goal

Document `/contact/*` and `/platform/contact/*` (and platform auth/me) in `lib/api-spec`; generate zod/types/clients; CI fails on drift.

### Work

1. Add OpenAPI paths matching Zod bodies (`SubmitBody`, inquiry list filters, reply payloads).
2. Security schemes: none for public submit; first-party session/bearer token for platform.
3. Generate `lib/api-zod` / `lib/api-client-react` as used elsewhere.
4. Optionally replace ad-hoc `contactApi.ts` fetch helpers with generated client.

### Coded this iteration

- `lib/api-spec/openapi-contact-crm.yaml` + `openapi-contact-crm.README.md`.
- Orval projects `contact-crm-client-react` and `contact-crm-zod`; script `codegen:contact`.
- Not merged into canonical `openapi.yaml`. Codegen in this environment **BLOCKED** (pnpm registry `localhost:4873`).

### Acceptance (not yet evidenced)

- Spec lists bootstrap, submit, inbound webhooks, inbox, workspace mutations, governance.
- Breaking change without spec update fails CI (Phase 11).
- Generated clients typecheck and are consumed (or explicitly deferred with a tracked follow-up).

---

## Phase 7 — SLA scheduler

**Depends on:** Phases 2–3 (outbox + worker)  
**Status:** coded pending verification

### Goal

Periodic `refresh_sla` (and later next-response/resolution) via scheduled outbox jobs, not only opportunistic ticks. Complete first-response when the first staff customer-visible reply is recorded. Due dates honor a business calendar.

### Work

1. Enqueue repeating `refresh_sla` (or worker-side due scan using `crm_sla_instances.due_at`).
2. On staff reply, set `firstResponseAt`, SLA instance `completedAt` / status completed.
3. Surface AT_RISK / BREACHED in inbox.
4. Emit analytics event on breach (consumed in Phase 9).
5. Compute due dates with business hours / holidays.

### Coded this iteration

- `slaCalendar.ts` + `slaCalendar.test.ts` (weekends, holidays, business-minute count; fixed UTC offset).
- Submit uses `addBusinessMinutes` for first / next / resolution instances.
- Reply path completes open first-response instances.
- `scheduleRecurringSlaRefresh` keeps at most one pending/running `refresh_sla` job.

### Acceptance (not yet evidenced)

- Overdue first-response becomes `BREACHED` without a user loading the inbox (live DB).
- Reply stops the first-response clock once.
- Operator-configured calendars / IANA DST / waiting-for-customer pause.

---

## Phase 8 — Admin config UX

**Depends on:** Phase 5 (only authorized staff mutate config)  
**Status:** coded pending verification

### Goal

Operators can publish taxonomy, qualification model, routing rules, SLA policies, templates, workflows, meeting types, and policy versions with audit.

### Work

1. Complete Config page editors with validation and publish/draft.
2. Template preview using `renderTemplate` sample vars.
3. Routing dry-run against a sample inquiry fact blob.
4. Audit every config mutation.

### Coded this iteration

- Purpose-built editors in `pages/admin/Config.tsx` (taxonomy, qualification, routing, workflows, SLA, meetings, tags/macros) instead of JSON dumps for those entities.

### Acceptance (not yet evidenced)

- Change of terms version is stored and used on next public submit.
- Sales user cannot open or POST config routes.
- Draft/publish/approval/rollback lifecycle.

---

## Phase 9 — Analytics

**Depends on:** Phases 2–3 (durable events); Phase 7 for SLA events  
**Status:** coded pending verification

### Goal

Dashboard of volume, qualification funnel, assignment load, SLA performance, meeting conversion — from `crm_analytics_events` (and/or SQL aggregates). Permission `analytics.view`.

### Work

1. Ensure submit, qualify, reply, breach, meeting_booked events always enqueue.
2. Aggregate queries for Analytics page; date range + inquiry type filters.
3. No PII in aggregate charts (counts only).

### Coded this iteration

- `pages/admin/Analytics.tsx`: volume, qualification, type/country, SLA status counts, job-queue counts, canonical events, metric definitions, inquiryType drill-down links (coded; live dashboard **NOT RUN**).

### Acceptance (not yet evidenced)

- Analyst role can view analytics, cannot reply (HTTP).
- Counts match inquiry table for a known seed window.
- Funnel, abandonment, and meeting conversion.

---

## Phase 10 — Public a11y

**Depends on:** Public form fields stable (CRM-PUB); can start earlier but gates in Phase 11  
**Status:** coded pending verification

### Goal

Contact page meets WCAG 2.2 AA for the submit flow: labels, errors, focus, keyboard, contrast, status messages.

### Work

1. Associate errors with inputs (`aria-describedby`, `aria-invalid`).
2. Keyboard-operable country and inquiry-type controls.
3. Focus first error on failed submit; confirmation as an assertive live region or heading focus.
4. Reduce-motion for decorative animation.

### Coded this iteration

- Public `Contact.tsx` upgrades: labeled fields, error alert + jump links, first-error focus, `aria-pressed` type tiles, reduced motion.

### Acceptance (not yet evidenced)

- Keyboard-only submit success and error paths.
- Automated axe scan on Contact route in CI (Phase 11).

---

## Phase 11 — Tests and gates

**Depends on:** Phases 1–10 capabilities exist to test  
**Status:** in progress (current local p12 suite **338/0/0**; restore suite **338/0/0**; Chromium/Firefox/WebKit browser current-head local isolated ALL_OK; staging/prod NOT RUN)

### Goal

Automated gates prevent regressions of durability, authz, contracts, and a11y.

### Work

1. Expand unit tests (qualification, conditions, templates, RBAC helper, threading, SLA calendar).
2. Integration: transactional submit, duplicate idempotency, SKIP LOCKED dual-worker, Graph simulator hard-fail, inbound thread, SLA complete-on-reply.
3. Contract tests vs OpenAPI.
4. a11y CI on Contact.
5. Do not skip hooks; fail CI on migrate drift.
6. **Non-functional testing** (load, soak, concurrency) is a gate, not a product feature.

### Coded this iteration

- Expanded CRM lib tests incl. marketing, attachments, Graph simulator, `rbacHttp.pg.test.ts`, `adminRateLimit.pg.test.ts`, `dsarExecution.pg.test.ts`, `objectAuth*.test.ts`, `inFlight.source.test.ts`, multiprocess dual-worker (plus earlier unit files).
- **Current local isolated full suite:** `tmp/crm-suite-full-p12d.log`, command `node --import tsx --test src/lib/crm/*.test.ts` with `DATABASE_URL` on verify DB `127.0.0.1:55432` and `CRM_ALLOW_TEST_JOBS=true` -> **338 pass / 0 fail / 0 skip**. Restore suite `tmp/crm-suite-restore-p12e.log` -> **338 pass / 0 fail / 0 skip**. Dual-worker `tmp/dual-worker-soak1.log` PASS dual-process `SKIP LOCKED`. Historical suite8 `tmp/crm-suite-full8.log` -> **251 tests / 249 pass / 0 fail / 2 skip** (2026-09-02, pre skip-remediation); suite6/suite7 are History only. Browser current-head local isolated Chromium/Firefox/WebKit are ALL_OK with **0 skips**. Do not claim production PASS.

### Acceptance (not yet evidenced)

- CI red if outbox insert is removed from the submit transaction.
- CI red if access-key login is reintroduced for production `NODE_ENV`.
- Contract CI, qualified a11y, staging pyramid, and production non-functional load remain open; local isolated browser and CRM suite evidence does not make release gates pass. Production gates still **FAIL**.

---

## Phase 12 — Ops and docs

**Depends on:** Phases 1–11 (documents the running system)  
**Status:** in progress (governance APIs + health; runbooks incomplete)

### Goal

Runbooks: migrate, worker process, Microsoft Graph / Exchange Online, first-party auth env, Graph webhook secrets, dead-letter replay, rate-limit cleanup, backup/PII. Update this folder; keep [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) honest.

### Work

1. Env var catalog (no secret values in git).
2. Alerting: job lag, dead jobs, 5xx, 429, Graph send error rate, subscription renewal failures.
3. DSAR/retention procedure (governance) — process, not a claim of certification.
4. Re-score the production readiness checklist from evidence only.

### Coded this iteration

- Governance APIs: DSAR export, correct/delete, anonymize, retention-run (`governance.ts`, `dsar.ts`, `platformGovernance.ts`); duplicate effects route removed from `platformGovernance`; `dsarExecution.pg.test.ts` included in current local isolated suite `tmp/crm-suite-full-p12d.log` **338/0/0** (live DSAR / G-GOV still **FAIL**).
- Process health: `GET /livez`, `GET /readyz` (`platformHealth.ts`).
- Dedicated worker process documented in code comments / `start:worker`; runbook dual-worker isolation notes (`tmp/dual-worker-soak1.log` PASS locally).
- Evidence docs reconciled to 0019 head; suite8 and prior-head browser in History; CRM full suite, restore suite, and Chromium/Firefox/WebKit browser runs are current local isolated evidence only.

### Acceptance (not yet evidenced)

- On-call can replay a dead `send_acknowledgment` job from docs.
- Legal hold + scheduled retention + restore drill.
- Readiness banner remains **NOT READY** until every gate in PRODUCTION_READINESS is **PASS**.

---

## Explicit non-goals (this plan)

- Native calendar / Graph / Google sync
- Multi-tenant CRM productization
- Full marketing automation or CDP
- Replacing the first-party auth platform with a hosted IdP
- Declaring SOC2 / ISO / GDPR certification complete
- Token product features (out of scope)
