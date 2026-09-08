# Contact CRM — local completion ledger (authorized scope)

THE ADVANCED CONTACT/INQUIRY CRM AND OMNICHANNEL CUSTOMER-COMMUNICATIONS PLATFORM ARE IMPLEMENTED AND LOCALLY VERIFIED WITHIN THE AUTHORIZED SCOPE. PRODUCTION DEPLOYMENT AND LIVE EXTERNAL-PROVIDER VERIFICATION REMAIN OUTSTANDING.

Frozen scope means the authorized product boundary is stable. It does not mean the implementation is basic or incomplete. This ledger does not describe the product as an MVP, demo, proof of concept, starter, simplified CRM, or minimal inbox.

**Worktree:** `fwie` · **branch:** `cursor/3b23f5cb` · **source:** `83ca53e` · **schema head:** `0020_crm_omnichannel_inbox.sql` · **isolated PG:** `127.0.0.1:55470`

Local implementation status vocabulary:

| Status | Meaning |
| --- | --- |
| **LOCALLY IMPLEMENTED AND VERIFIED** | Architecture and behavior exist and passed local engineering/browser evidence. |
| **IMPLEMENTED AWAITING CREDENTIALS** | Connector/architecture complete; live round trip needs provider credentials. |
| **PRODUCTION/STAGING DEPLOYMENT OUTSTANDING** | Not applied to a shared staging/production environment. |
| **PROVIDER APPROVAL OUTSTANDING** | App review / partner access still required by the provider. |
| **QUALIFIED EXTERNAL REVIEW OUTSTANDING** | Independent WCAG, ASVS, legal, or statutory review not claimed. |
| **POST-RELEASE ENHANCEMENT** | Optional after launch; not a local architecture gap. |

## Requirement ledger

| ID | Capability | Local implementation | Outstanding item (not a local architecture gap) |
| --- | --- | --- | --- |
| C-CONTACT | Public Contact experience, progressive disclosure, qualification, references | **LOCALLY IMPLEMENTED AND VERIFIED** (Suite A) | Staging smoke |
| C-CRM | Contacts, companies, inquiries, routing, ownership, assignment, SLA, conversations, messages | **LOCALLY IMPLEMENTED AND VERIFIED** (CRM suite 418/0/0) | Staging/production deployment |
| C-INBOX | Unified omnichannel inbox, identities, search/filters/keyset/saved views, status/priority/tags/notes, replies, delivery | **LOCALLY IMPLEMENTED AND VERIFIED** (Suite B) | Live social/Graph round trips |
| C-JOBS | Durable jobs, effects, leases, retries, dead-letter, uncertain-delivery reconciliation, replay | **LOCALLY IMPLEMENTED AND VERIFIED** (CRM suite + dual-worker SKIP LOCKED) | Production-scale soak |
| C-GRAPH | Microsoft Graph email architecture | **IMPLEMENTED AWAITING CREDENTIALS** | Entra/Exchange live round trip |
| C-WA | WhatsApp official connector architecture | **IMPLEMENTED AWAITING CREDENTIALS** | Meta credentials/approval + live verification |
| C-MSG | Messenger official connector architecture | **IMPLEMENTED AWAITING CREDENTIALS** | Meta credentials/approval + live verification |
| C-IG | Instagram official connector architecture | **IMPLEMENTED AWAITING CREDENTIALS** | Meta credentials/approval + live verification |
| C-X | X official connector architecture | **IMPLEMENTED AWAITING CREDENTIALS** | API access/credentials + live verification |
| C-TT | TikTok | **LOCALLY IMPLEMENTED AND VERIFIED** as unsupported-by-public-API | — |
| C-LI | LinkedIn private messaging | **LOCALLY IMPLEMENTED AND VERIFIED** as partner-gated | Partner access |
| C-CFG | Governed configuration draft/review/approval/publish/rollback | **LOCALLY IMPLEMENTED AND VERIFIED** | Staging publish |
| C-CMS | CMS editorial governance | **LOCALLY IMPLEMENTED AND VERIFIED** (Suite C) | Staging CDN |
| C-ANL | Analytics and durable exports | **LOCALLY IMPLEMENTED AND VERIFIED** (Suite C CSV 78-byte `metric,value`) | Staging |
| C-DSAR | DSAR, retention, legal-hold foundations | **LOCALLY IMPLEMENTED AND VERIFIED** (Suite C) | **QUALIFIED EXTERNAL REVIEW OUTSTANDING** (not a statutory claim) |
| C-ATT | Attachment storage/scanning abstraction, fail-closed production | **LOCALLY IMPLEMENTED AND VERIFIED** | Object-storage credentials |
| C-AUTH | RBAC and object-level authorization | **LOCALLY IMPLEMENTED AND VERIFIED** | Live Clerk tenant |
| C-I18N | Localization and RTL | **LOCALLY IMPLEMENTED AND VERIFIED** (906-key parity; Suite D) | Qualified Arabic legal translation |
| C-SEO | SEO architecture | **LOCALLY IMPLEMENTED AND VERIFIED** (SEO HTML PASS) | Production crawl |
| C-A11Y | Accessibility engineering | **LOCALLY IMPLEMENTED AND VERIFIED** (bounded Suites A–D) | Formal WCAG certification **NOT CLAIMED** |
| C-MIG | Migrations through 0020, dump/restore, worker recovery | **LOCALLY IMPLEMENTED AND VERIFIED** | Staging/production migrate |
| C-BOT | Turnstile hostname/action enforcement | **IMPLEMENTED AWAITING CREDENTIALS** | Live Turnstile site/secret |

## Accepted local evidence (preserve)

- Bounded browser Suites A–D; Chrome, Edge, Firefox, WebKit representative compatibility; retries=0
- API typecheck/build PASS; website typecheck/full production build PASS
- SEO HTML PASS; i18n 906-key parity PASS; public-copy engineering gate PASS; performance-budget gate PASS
- CRM suite **418 pass / 0 fail / 0 skip**
- Migrations through schema head **0020** PASS; dump/restore at 0020 PASS
- Worker heartbeat and dual-worker SKIP LOCKED recovery PASS
- OpenAPI/Orval drift PASS
- Combined A–E mega-matrix (Chrome-13): **HISTORICAL FAIL** — not a closure gate
- Native browser crashes with 3/3 isolated PASS: **LIMITED_EVIDENCE** (not product defects)

## Channel language (authoritative)

- Website Contact: locally operational and verified.
- Microsoft Graph: implemented, awaiting Entra/Exchange credentials and live round-trip verification.
- WhatsApp: implemented, awaiting Meta credentials/approval and live verification.
- Messenger: implemented, awaiting Meta credentials/approval and live verification.
- Instagram: implemented, awaiting Meta credentials/approval and live verification.
- X: implemented, awaiting API access/credentials and live verification.
- TikTok: unsupported by the available public support-messaging API.
- LinkedIn private messaging: partner-gated.

No fixture, simulator, environment flag, or configured credential creates a LIVE_VERIFIED claim.

## Not claimed

Samsung Internet real-device testing: **NOT RUN**. Live Microsoft Graph / WhatsApp / Messenger / Instagram / X round trips: **NOT VERIFIED**. Formal WCAG certification: **NOT CLAIMED**. Independent ASVS certification: **NOT CLAIMED**. Legal approval or statutory GDPR/CCPA compliance: **NOT CLAIMED**. Production deployment has **not** occurred.

Related: [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) · [REQUIREMENTS_TRACEABILITY_MATRIX.md](./REQUIREMENTS_TRACEABILITY_MATRIX.md) · [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) · [RUNBOOK.md](./RUNBOOK.md)
