# ADR-001 — Contact CRM architecture

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-31 |
| **Context** | Public Contact Us + Platform Contact Operations for ClaimTagX |
| **Deciders** | Platform engineering (ClaimTagX website worktree) |

---

## Context

The Contact CRM must accept public inquiries, qualify and route them, notify staff, send transactional email, and give operators an inbox — without coupling to venue/handler product tables. Early implementation used in-memory rate limits, sequential (non-transactional) inserts, an in-process job poller, a shared staff access key, and a Resend helper that logs provider errors instead of failing the job.

Production requirements demand:

- Staff identity that is personal, revocable, and auditable.
- No lost acknowledgments if the API process crashes after commit.
- Safe concurrency when more than one worker or instance runs.
- Rate limits that work across instances.
- Schema changes that are reviewable SQL, not implicit `push`.
- Email that is reliable enough to retry, not silently skipped.
- Meetings without building a calendar product.

---

## Decision

### 1. First-party staff auth (not shared access keys)

Staff sign in with ClaimTagX first-party auth. Platform authorization is a row in `crm_staff` keyed by verified email and `auth_account_id`, with `role` + `permissions` enforced by `requirePlatformAdmin` / `requirePermission`.

- Production must **not** accept a shared `PLATFORM_STAFF_ACCESS_KEY` as a login credential.
- Allowlist (`PLATFORM_ADMIN_EMAILS`) and staff `status = active` remain the gate for who may become or remain staff.
- HMAC cookie sessions are backed by the first-party auth account and must not become a shared-key substitute.
- The public contact form remains unauthenticated.

### 2. Postgres `crm_jobs` as transactional outbox + dedicated worker with `SKIP LOCKED`

Business writes (company, contact, inquiry, conversation, message, consent, qualification, SLA instance, audit, routing cursor) and **outbox rows** (`crm_jobs`) commit in **one database transaction**.

A **dedicated worker** (same binary is acceptable if it only claims jobs; preferred: isolated process) polls due jobs using:

```sql
SELECT ... FROM crm_jobs
WHERE status = 'pending' AND run_at <= now()
ORDER BY run_at
FOR UPDATE SKIP LOCKED
LIMIT n;
```

Retries use bounded backoff and `max_attempts`; exhausted jobs go to `dead`. Workers never process a job whose parent transaction did not commit.

### 3. Database-backed rate limits

Public submit (and inbound webhooks) use **Postgres-backed** counters (table such as `crm_rate_limits` or equivalent upsert of key + window), not a process `Map`. Limits must be correct with multiple API instances and survive restarts.

### 4. Drizzle migrations path

CRM schema lives in `lib/db/src/schema/crm.ts`. Changes ship as **generated SQL under `lib/db/drizzle`**, applied with the existing drizzle-kit / migrate pipeline. Production must not rely on ad-hoc `drizzle-kit push` for CRM tables.

### 5. Bounded CRM modules

Contact CRM is a bounded context:

| Layer | Responsibility |
| --- | --- |
| Schema | `crm_*` tables only; FKs stay inside CRM |
| Domain | `artifacts/api-server/src/lib/crm/*` (orchestrator, qualification, jobs, rbac, templates, audit) |
| Public HTTP | `routes/contact.ts` |
| Staff HTTP | `routes/platformContact.ts` |
| Public UI | `artifacts/claimtagx` Contact page |
| Staff UI | `artifacts/claimtagx/src/pages/admin/*` |

Do not reuse venue `messages`, intercom, or handler invitation tables for inquiries.

### 6. Microsoft Graph / Exchange Online as email platform

Outbound mail goes through **Microsoft Graph** `sendMail` from a configured Exchange Online mailbox (`MS_GRAPH_MAILBOX_UPN`, `EMAIL_FROM`).

- Production requires Entra ID app registration with admin-consented **Mail.Send** (application) and inbound **Mail.Read** (application), plus `MS_GRAPH_*` configuration documented in `microsoftGraph/config.ts`.
- Missing Graph configuration in **production** is a readiness failure (`/readyz` returns 503).
- Provider API errors and thrown exceptions **fail the job**. Completing a `send_acknowledgment` job without provider acceptance is a defect.
- Local verification uses `CRM_GRAPH_SIMULATOR` / `CRM_EMAIL_SIMULATOR` / `CRM_ALLOW_TEST_JOBS` — not allowed in production.
- Persist provider request/message identifiers on effects and `crm_messages` when available so inbound threading can use `In-Reply-To` / `References`.
- Inbound replies use Graph change notifications (`POST /contact/webhooks/microsoft-graph/mail`) with validation-token handshake, `clientState` verification, subscription renewal, and delta-query recovery (`crm_graph_mailbox_state`).

### 7. External scheduling URL for meetings

Meeting types store an **external booking URL** (`crm_meeting_types.booking_url`, `calendar_source = external`). Qualification/workflows attach a parameterized URL (name, email, inquiry reference). Optional `POST /contact/webhooks/scheduling` updates booking status. ClaimTagX does not host calendar availability in v1.

---

## Consequences

### Positive

- Staff access is individual and revocable; audit actor IDs map to people, not a shared secret.
- Acknowledgments, staff notifications, and workflows survive the request process if the transaction committed.
- Multiple workers can run without double-sending when claims use `SKIP LOCKED`.
- Rate limits remain effective behind a load balancer.
- Schema review happens in git as SQL.
- CRM can evolve without venue-schema coupling.
- Failed mail is visible in `crm_jobs.last_error` / `dead` instead of silent gaps.
- Scheduling can change vendors (Calendly, SavvyCal, etc.) without a calendar rewrite.

### Negative / operational cost

- First-party auth is a production dependency for operators; auth-service or database outage blocks inbox (public submit does not).
- Every submit requires a transactional pattern (connection, rollback, outbox) — more code than fire-and-forget inserts.
- A worker must be running or the outbox stalls; ops must alert on lag and dead letters.
- DB rate-limit rows need TTL/cleanup.
- Migration discipline is mandatory before schema edits.
- Hard-fail email increases retries and may duplicate customer mail unless sends are made idempotent (provider idempotency keys / “already sent” message rows).
- External scheduler means booking truth is eventually consistent via webhook.

### Risks to manage

- Dual auth (first-party auth + shared access key) must be removed; leaving both is a security regression vs this ADR.
- Early Resend helper swallowed errors — replaced by Microsoft Graph adapter that fails jobs on provider errors.
- In-process `setInterval` is not a substitute for a dedicated SKIP LOCKED worker in production.

---

## Alternatives considered

### Staff auth: shared access key / HMAC cookie only

**Rejected.** A single `PLATFORM_STAFF_ACCESS_KEY` cannot be rotated per person, appears in the login UI, and cannot satisfy least-privilege or offboarding. HMAC cookies signed with that key inherit the same blast radius. ClaimTagX first-party auth is the staff identity system; `crm_staff` remains the authorization record.

### Jobs: in-request side effects / Redis queue / pg-boss as product dependency

**Rejected for v1 core path.** Sending email inside `POST /contact/inquiries` couples latency and failure to the public UX. An external broker (Redis, SQS) adds another system before CRM durability exists. **pg-boss** (or similar) remains a future option; the accepted v1 design is **SQL outbox in `crm_jobs`** so the inquiry row and the work item cannot diverge.

### Worker: `SELECT` then `UPDATE` without `SKIP LOCKED`

**Rejected for production.** Two instances can select the same pending row. Optimistic `status = pending` updates reduce but do not eliminate races and wasted work. `FOR UPDATE SKIP LOCKED` is the Postgres-native claim.

### Rate limits: memory / Redis-only

**Rejected as primary.** In-memory maps reset on deploy and split across instances. Redis is valid later for high QPS; v1 stays on Postgres next to the outbox to keep operational surface small.

### Schema: `drizzle-kit push` in production

**Rejected.** Push is acceptable only for local experiments. CRM uniqueness (references, idempotency keys, staff account links) must be versioned SQL.

### Monolith tables shared with venue messaging

**Rejected.** Inquiry conversations have different actors, SLAs, and retention than venue chat/intercom.

### Email: log-and-continue / SMTP / vendor lock-in beyond adapter

**Rejected.** Silent skip creates false “inquiry accepted, customer never emailed.” SMTP is not the team’s operational skill. Microsoft Graph is an **adapter**; the domain depends on `sendTransactionalEmail` throwing on failure, not on Graph-specific types leaking into orchestrator.

### Meetings: first-party calendar / Microsoft Graph / Google Calendar sync

**Deferred.** Too large for the contact launch. External URL + webhook covers qualified-lead booking. Native calendar sync would be a later ADR.

---

## Compliance with this ADR (implementation checklist)

Status is code-vs-ADR only — not production release evidence. Release gates remain FAIL / BLOCKED / NOT RUN in [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).

| Decision | Current code vs ADR |
| --- | --- |
| First-party auth | Session middleware and staff resolution exist; access-key login gated off in production — **partially compliant** until shared-key path fully removed from non-prod surfaces |
| Transactional outbox | Submit path commits inquiry + `crm_jobs` in one transaction — **compliant in code**; staging/prod evidence **NOT RUN** |
| SKIP LOCKED worker | `claimJobs` uses `FOR UPDATE SKIP LOCKED` + leases; dedicated `worker.ts`; harness types excluded via `type NOT LIKE 'dual_proc_verify%'` — **compliant in code**; last suite8 local PASS (historical, pre skip-remediation) — not release evidence |
| DB rate limits | Postgres `crm_rate_limits` + admin limiter — **compliant in code**; multi-instance soak incomplete |
| Drizzle migrations | Versioned SQL through **0023** (including first-party auth identity finalization) — **compliant in code**; local bootstrap/restore evidence exists; staging/prod apply **NOT RUN** |
| Bounded modules | Largely followed |
| Graph hard fail | Production adapter fails jobs on provider errors — **compliant** (simulator/local only outside production); live tenant **BLOCKED** |
| External scheduling URL | Followed (`crm_meeting_types.booking_url`) |

Closing remaining gaps is sequenced in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).
