# Contact CRM — Operations runbook

**Reconciled:** 2026-09-08 · worktree `fwie` · branch `cursor/3b23f5cb` · source `83ca53e` · schema **0020**

THE ADVANCED CONTACT/INQUIRY CRM AND OMNICHANNEL CUSTOMER-COMMUNICATIONS PLATFORM ARE IMPLEMENTED AND LOCALLY VERIFIED WITHIN THE AUTHORIZED SCOPE. PRODUCTION DEPLOYMENT AND LIVE EXTERNAL-PROVIDER VERIFICATION REMAIN OUTSTANDING.

Bounded Suites A–D (not combined A–E) are the accepted local browser evidence. Chrome-13 mega-matrix is HISTORICAL FAIL and is not a closure gate. Activate each provider channel only after a successful live round trip. No fixture or simulator creates a LIVE_VERIFIED claim.

## Isolated local verification (throwaway)

Not production. Owned cluster data dir `tmp/claimtagx-crm-verify/pgdata` listens on `127.0.0.1:55470` (do not create another install; do not use 5432 or unowned 55432). Databases `claimtagx_crm_verify` and `claimtagx_crm_verify_restore`. Credentials: `tmp/claimtagx-crm-verify/credentials.env`.

### Live Contact browser E2E (local)

1. Start the **existing** Postgres verify cluster on `127.0.0.1:55470` (`pg_ctl -D tmp/claimtagx-crm-verify/pgdata -o "-p 55470 -h 127.0.0.1"`).
2. API: `CRM_EMBED_WORKER=false`, `CRM_GRAPH_SIMULATOR=true`, `CRM_EMAIL_SIMULATOR=true`, `CRM_PUBLIC_SUBMIT_RATE_MAX=200`, `LISTEN_HOST=127.0.0.1`, `PORT=18080`, `node dist/index.mjs`.
3. Worker: dedicated `node dist/worker.mjs` with the same `DATABASE_URL`.
4. Vite: `PORT=5173` `pnpm run dev` in `artifacts/claimtagx`.
5. Playwright: `CRM_E2E_API=http://127.0.0.1:18080` `PLAYWRIGHT_SKIP_WEBSERVER=1` then browser projects. Prefer sequential helper `tmp/run-contact-e2e.ps1` (API auto-revive).
6. DB probe: `node --import tsx scripts/verify-live-contact-db.mts` from `artifacts/api-server`.

Clear `crm_rate_limits` between large live matrices. Prefer dedicated worker over `CRM_EMBED_WORKER` under browser load (Windows ACCESS_VIOLATION observed with embedded worker under sustained inquiry load).

**Current browser evidence:** bounded Suites A–D under `tmp/qualification/20260906T000400Z-83ca53ec9d86-combined/` (`pw-suite-a-*`, `pw-suite-b-*`, `pw-suite-c-*`, `pw-suite-d-*`). Do **not** run combined Chrome/Edge/WebKit A–E mega-matrix. Qualification: `tmp/run-contact-e2e.ps1` with `PLAYWRIGHT_RETRIES=0`, fresh process per suite and engine, preview dist.

### Dual-worker / multiprocess suite isolation

When running the full CRM lib suite or `multiprocess.pg.test.ts` against the verify DB:

1. **Prefer:** stop any live dedicated worker (`dist/worker.mjs`) and any API with `CRM_EMBED_WORKER=true` that shares `DATABASE_URL` — concurrent drain was the suite7 root cause (multiprocess claimed 0).
2. **Also:** harness jobs use unique types under `dual_proc_verify%`; `claimJobs` excludes `type NOT LIKE 'dual_proc_verify%'`. Last clean inclusion: suite8 (historical, **249 pass / 0 fail / 2 skip**). Still prefer stopping live workers during suite runs.
3. Do not run load/browser E2E workers against the same DB while multiprocess verification is in flight.

### CRM suite skips (remediated in code — re-verify)

| Skip (historical suite8) | Prior cause | Remediation at `83ca53e` | Re-verification |
| --- | --- | --- | --- |
| listen-bind | `CRM_VERIFY_LISTEN` unset | `listenBind.isolation.test.ts` asserts isolated loopback 55470/55432 | Confirmed **418/0/0** in tmp/crm-suite-full-closure-2.log |
| deferred migrate apply | `CRM_ALLOW_MIGRATE` unset | `migrationApply.deferred.test.ts` non-destructive assert verify DB head ≥ **0020** + SQL files through 0020 | Confirmed **418/0/0** in tmp/crm-suite-full-closure-2.log |

Command (post-remediation):

```bash
node --import tsx --test src/lib/crm/*.test.ts
# with DATABASE_URL + DATABASE_URL_RESTORE + CRM_ALLOW_TEST_JOBS=true; log to tmp/crm-suite-*.log
```

These remediations do **not** make a production PASS until confirmed 0 fail / target skips.

### Browser Contact E2E skip remediation (coded — re-verify)

| Test area | Prior skip cause | Remediation | Re-verification |
| --- | --- | --- | --- |
| Firefox 200%/400% zoom | CSS `zoom` unsupported | Viewport-width / 2 and / 4 reflow in `e2e/contact.spec.ts` (+ admin/public a11y specs) | Chromium/Firefox/WebKit current-head Contact/Admin **0 skips**; admin/public reflow covered in `tmp/pw-a11y-beyond2.log` |
| Live matrix / 503 recovery | Limited to `*-1440` | Runs on all viewports when `CRM_E2E_API` and `CRM_ADMIN_E2E=1` are set | Chromium/Firefox current-head **0 skips**; WebKit current-head log tmp/pw-webkit-p12.log |

**Historical prior-head logs (do not treat as current):** Chromium `tmp/pw-chromium-full-live3.log` **141/0/24**, Firefox `tmp/pw-firefox-full2.log` **131/0/34**, WebKit `tmp/pw-webkit-full5.log` **141/0/24** (2026-09-02).

### Load / G-PERF

Local isolated load is **authorized**. Production load remains **NOT RUN**.

- **Historical FAIL (do not cite as PASS):** `tmp/load-soak-beyond-matrix2.log` — global pending grew 1567→2201; no workload drain.
- **Current local drain + capacity PASS (not production SLO):** clean DB `claimtagx_crm_soak` (baseline jobs_total=0), run `soak-1788454320813-dc214c7c`, evidence `tmp/load-soak-drain-p12.json`. Matrix **1×1 / 2×2 / 4×2 / 4×4**. Workload pending=0, running=0, unexpected dead=0; one intentional poison dead per cell. Steady/burst **retried=0**. The only `attempts>1` jobs are 12 injected `__test_fail_until` retry-storm jobs per cell (classified `deliberately_injected`). Drain times: 1×1 steady 2.6s (24 jobs), burst 5.1s (71); 4×2 steady 4.6s (96), burst 10.2s (303). Burst throughput ~14–16 jobs/s/worker. Prior 50–230s drains and 4×2 90 retries were heartbeat-teardown tax + lease-steal from oversized sequential claim batches — fixed in this worktree. Production load remains **NOT RUN**.

## Processes

| Process | Command | Notes |
| --- | --- | --- |
| API | `pnpm --filter @workspace/api-server start` | Do **not** embed the worker in production |
| Worker | `pnpm --filter @workspace/api-server start:worker` | Required for email, workflows, SLA refresh, analytics fan-out |
| Marketing | Cloudflare Pages build via `scripts/build-cf-pages.sh` | Set `VITE_API_BASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY` |

## Environment (minimum)

- `DATABASE_URL`
- `PORT`
- `LISTEN_HOST` (required in production; `127.0.0.1` when a reverse proxy is on the same host)
- `CORS_ALLOWED_ORIGINS` (include marketing origin)
- `PLATFORM_ADMIN_EMAILS`
- `PLATFORM_STAFF_SESSION_SECRET` (production required; must not equal access key)
- `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, and **either** `MS_GRAPH_CLIENT_SECRET` **or** (`MS_GRAPH_CLIENT_CERTIFICATE` / `MS_GRAPH_CLIENT_CERTIFICATE_PATH` + `MS_GRAPH_CLIENT_CERTIFICATE_THUMBPRINT`)
- `MS_GRAPH_MAILBOX_UPN`, `MS_GRAPH_NOTIFICATION_URL`, `MS_GRAPH_CLIENT_STATE`
- `MS_GRAPH_DELTA_ENCRYPTION_KEY` (32-byte base64 or hex)
- `EMAIL_FROM` (must align with mailbox/domain policy)
- `CONTACT_INBOUND_WEBHOOK_SECRET` (local fixture webhook only; production uses Graph notifications)
- `CRM_SKIP_RUNTIME_SEED=true` after controlled config deploy
- Never set `PLATFORM_ALLOW_ACCESS_KEY_LOGIN` in production
- Never set `CRM_EMBED_WORKER=true` in production

## Health

- `GET /api/livez` — process up
- `GET /api/readyz` — database `SELECT 1` + Microsoft Graph config validation in production
- `GET /api/healthz` — legacy ok

## Alerts (define in your APM)

| Alert | Condition |
| --- | --- |
| Worker lag | `crm_jobs` pending oldest `run_at` age > 5m |
| Dead letters | `crm_jobs.status='dead'` count increasing |
| SLA breaches | `crm_sla_instances.status='BREACHED'` new rows |
| Auth failures | 401/403 spike on `/api/platform/*` |
| Rate limit | 429 spike on `/api/contact/inquiries` |
| Ready fails | `/api/readyz` non-200 |
| Dead jobs | `evaluateJobAlert("crm.jobs.dead")` warn at 1, critical at 5 (`jobAlerts.ts`) |
| Oldest pending | warn 60s / critical 300s |
| Worker saturation | warn 0.85 / critical 0.95 of `CRM_WORKER_CONCURRENCY` |

Pipeline JSONL (`CRM_JOB_PIPELINE_LOG`) is optional; set `off` to disable. Write failures must not fail jobs. Correlation IDs are hashed; emails are stripped. Rotate/delete JSONL with the same retention as application logs.

Session/signing rotation: set `PLATFORM_STAFF_SESSION_SECRET_PREVIOUS` / `CRM_ATTACHMENT_SIGNING_SECRET_PREVIOUS` to the retiring value, deploy the new current secret, wait until cookies/URLs expire, then remove previous.

## Migrations

Current schema head: **0019_crm_staff_routing_attributes.sql** (after `0017_crm_saved_views_enterprise.sql`; the former `0017` marketing audit migration was renamed to `0018` to avoid duplicate `0017` filenames).

Prefer the versioned applicator (do not rely on one-off `psql -f` of a single mid-chain file):

```bash
# Load credentials for the isolated verify cluster, then:
node artifacts/api-server/node_modules/tsx/dist/cli.mjs lib/db/src/migrate-cli.ts
```

Historical note: older runbook examples that only applied `0003`/`0004` are incomplete for current schema.

Restore verification (after backup restore, staging or isolated restore DB only):

```bash
node scripts/crm-infra-verify.mjs --restore-sql
```

**Restore evidence status:**

| Item | Status | Notes |
| --- | --- | --- |
| `tmp/restore-functional-fresh3.log` | **Historical** | **3 pass / 0 fail** against `dump-0014.sql` (0014 head, 2026-09-02) |
| `tmp/claimtagx-crm-verify/dump-0014.sql` | **Stale** | Does not include 0015-0019 |
| Fresh 0019 dump-p12 + restore-functional-p12 | **PASS** (local isolated) | `tmp/claimtagx-crm-verify/dump-p12.sql`; `tmp/restore-functional-p12.log` **3/0**; G-RESTORE remains **FAIL** (staging/prod **NOT RUN**) |
| Full CRM suite on restore DB | **PASS** (local isolated) | tmp/crm-suite-restore-p12e.log **338/0/0** |

Dual-worker claim SQL (stop live workers first — see dual-worker isolation above):

```bash
node scripts/crm-infra-verify.mjs --dual-worker-sql
```

Load/soak: `node scripts/crm-infra-verify.mjs --load-plan`  
Clerk 401: `node scripts/crm-infra-verify.mjs --clerk-plan` (**BLOCKED** — real tenant)  
Graph readiness: `node scripts/crm-infra-verify.mjs --graph-plan` (**BLOCKED** — live tenant)

Microsoft Graph check: with `MS_GRAPH_*` unset in production, `/api/readyz` must return 503 and send jobs must fail (not complete).

Inbound mail uses Microsoft Graph change notifications at `POST /contact/webhooks/microsoft-graph/mail` (validation token handshake + `clientState`). Delta recovery uses encrypted tokens in `crm_graph_mailbox_state`. Local fixture webhook `POST /contact/webhooks/inbound-email` remains for tests only (410 in production).

Orval (local binary; no registry):

```bash
node lib/api-spec/node_modules/orval/dist/bin/orval.mjs --config lib/api-spec/orval.config.mjs --project contact-crm-client-react --verbose
```

Clerk check: `PLATFORM_ADMIN_EMAILS` allowlist + staff invite; unsigned `/platform/contact/inquiries` returns 401.

OpenAPI client catalog (metadata only): `node scripts/sync-contact-crm-ops.mjs --write`

## Rollback

Rollback notes: `lib/db/drizzle/ROLLBACK.md` (staging only; production requires explicit authorization).

## Incident: stuck jobs

1. Inspect `crm_jobs` where `status='running'` and `lease_expires_at < now()`.
2. Worker reclaim will pick them up via SKIP LOCKED lease expiry.
3. Dead letters: inspect `last_error`, fix root cause, re-enqueue with authorization.

## Incident: email not sending

1. Confirm worker process is running.
2. Confirm `MS_GRAPH_*` configuration and `/api/readyz`.
3. Inspect `crm_job_effects`, `crm_outbound_sends`, and dead `send_acknowledgment` jobs.
4. For uncertain sends, use Operations UI/API reconcile before replay.
