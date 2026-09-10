# Contact CRM — list pagination

Offset pagination is **not** an accepted architecture for operational mutable datasets.

## Keyset / cursor (required)

| Surface | Sort | Tie-breaker | Forward | Backward | Notes |
| --- | --- | --- | --- | --- | --- |
| Inquiries inbox | `createdAt` (default) | `id` | `nextCursor` | client cursor stack | Authorization via `inquiries.view` + object auth on mutate |
| Jobs | `createdAt` desc | `id` | `nextCursor` | not in UI | Bounded `limit` ≤ 200 |
| Effects | `createdAt` desc | `idempotencyKey` | `nextCursor` | not in UI | |
| Audit events | `createdAt` desc | `id` | `nextCursor` | not in UI | Filter `inquiryId` encoded by repeating query params |
| Attachments | `createdAt` desc | `id` | `nextCursor` | not in UI | |
| Config change drafts | `createdAt` desc | `id` | `nextCursor` | not in UI | |

Inbox UI (`Inbox.tsx`) consumes `cursor` / `nextCursor` for `createdAt` sort. Previous page uses a client-held cursor stack (the previous page’s cursor), not SQL `OFFSET`.

## Documented exceptions (not “accepted at scale”)

| Surface | Mechanism | Max | Reason |
| --- | --- | --- | --- |
| Inquiries `sort=score` or `sort=lastActivityAt` | `OFFSET` still accepted | page ≤ 100 | Compound keyset for nullable score / lastActivity is not wired yet; **defect to replace**, not an authorized scale design |
| Duplicate-contact lookup | unpaginated | 50 | Point lookup by email/phone, not a feed |
| Staff/teams, templates, taxonomy, workflows, SLA policies, macros, tags, meeting types | unpaginated / small catalogs | implicit seed size | Immutable-ish reference catalogs |
| Webhook receipts | `LIMIT 200` no cursor | 200 | Operator debug snapshot |
| Dead-letter jobs | in-memory filter after SQL | 200 | `q` substring filter; replace with keyset when type+error search is indexed |
| Marketing document list / version list / audit | `LIMIT` 200 | 200 | Catalog + per-document audit; add cursor if volume grows |
| Saved views | per-staff small set | — | Not a high-churn feed |
| Analytics breakdown tables | `LIMIT 25` aggregates | 25 | Aggregate dashboard, not a row feed |
| Export job list | staff-scoped `limit` | 50 | Per-operator artifacts |

None of these exceptions authorize offset pagination for inquiries/jobs/effects/audits/attachments at production volume.
