# Contact CRM OpenAPI fragment

Standalone OpenAPI 3.1 document for ClaimTagX public Contact Us and Platform
Contact Operations. It is **not** yet wired into Orval.

| File | Role |
| --- | --- |
| [`openapi.yaml`](./openapi.yaml) | Canonical venue/handler product spec. Orval input. Title **must** stay `Api`. |
| [`openapi-contact-crm.yaml`](./openapi-contact-crm.yaml) | Contact CRM paths, schemas, security. Same `/api` server prefix. |
| [`orval.config.ts`](./orval.config.ts) | Reads **only** `./openapi.yaml`. |

Route sources: `artifacts/api-server/src/routes/contact.ts`,
`artifacts/api-server/src/routes/platformContact.ts`. Permission strings match
`PLATFORM_PERMISSIONS` in `artifacts/api-server/src/lib/crm/rbac.ts`.

## Why a separate file

The product spec is already consumed by `@workspace/api-zod` and
`@workspace/api-client-react`. Merging CRM blindly would regenerate those
packages. Keep this fragment reviewable until Phase 6 (see
`docs/contact-crm/IMPLEMENTATION_PLAN.md`) is ready to generate clients.

## Merge into `openapi.yaml`

Do **not** change `info.title` (`Api`) or the existing `/api` server URL.

### 1. Tags

Append the CRM tags from the fragment (`contact-public`, `contact-webhooks`,
`platform-auth`, `platform-inquiries`, `platform-templates`, `platform-config`,
`platform-workspace`, `platform-governance`).

### 2. Security schemes

Copy `components.securitySchemes` (`clerkBearer`, `platformCookie`,
`webhookSecret`) into the main document. The product spec currently has none.

### 3. Shared parameters, responses, schemas

Copy:

- `components.parameters`
- `components.responses`
- `components.schemas`

CRM schema names are prefixed (`Contact*`, `Crm*`, `Platform*`) so they do not
collide with `ApiErrorMessage`, `CustodyAsset`, etc. Public submit errors use
`ContactApiError` (`error` plus optional `correlationId`). Platform errors are
the same shape with `error` only.

### 4. Paths

Copy every path object under `paths:` into `openapi.yaml`. Paths are already
relative to `/api` (Express mounts the router at `/api`).

**Do not** wrap them as `/api/contact/...`. Clients call
`/api/contact/bootstrap` because Orval `baseUrl` is `/api`.

### 5. `$ref` style (optional, keeps files split)

Instead of copying, you can leave the fragment on disk and point the main
document at it. JSON Pointer encoding for `/` is `~1`:

```yaml
# openapi.yaml (excerpt)
paths:
  /contact/bootstrap:
    $ref: "./openapi-contact-crm.yaml#/paths/~1contact~1bootstrap"
  /contact/inquiries:
    $ref: "./openapi-contact-crm.yaml#/paths/~1contact~1inquiries"
  # ...repeat for each path
```

You still need to merge (or `$ref`) `components` that those operations use.
Orval must be able to resolve local file refs; if it cannot, copy-merge.

### 6. Codegen

After the main document includes CRM paths:

```bash
pnpm --filter @workspace/api-spec codegen
```

That regenerates `lib/api-zod` and `lib/api-client-react`. Then typecheck the
workspace. Optionally replace hand-rolled helpers in
`artifacts/claimtagx/src/lib/contactApi.ts`.

### 7. Planned operations and codegen

Operations with `x-status: planned` are **not implemented** today:

| operationId | Path | Permission |
| --- | --- | --- |
| `getPlatformContactDsarExport` | `GET /platform/contact/dsar-exports/{exportId}` | `inquiries.export` |

Saved views (GET/POST/PUT/DELETE), standalone audit list, DSAR contact export,
presence/locks/exports, attachments list + quarantine release, effects get/reconcile,
DSAR correct/delete/object, legal-hold release, retention-run, business-calendar /
retention-policy / spam-bot-policy PUTs, marketing publish-failures + reconcile-publish,
Graph mail webhook, and contacts duplicates are `x-status: implemented`.

Until the remaining planned handler exists, either:

- omit planned paths from the merge, or
- keep them and expect 501 / unused generated hooks.

Filter on `x-status: planned` if you add an Orval transformer.

## Auth

| Surface | Scheme |
| --- | --- |
| `GET /contact/bootstrap`, `POST /contact/inquiries` | none |
| Webhooks | `X-Webhook-Secret` (`webhookSecret`) |
| `POST /platform/auth/login` | none; **410** in production unless the non-prod access-key override is on |
| `POST /platform/auth/logout` | none (clears cookie) |
| All other `/platform/*` | Clerk `Authorization: Bearer` **or** cookie `ctx_platform_session` |

OpenAPI `security` is an OR of `clerkBearer` and `platformCookie`, matching
`requirePlatformAdmin`.

## Permissions (`x-permission`)

Each gated platform operation sets `x-permission` to one of:

`inquiries.view`, `inquiries.reply`, `inquiries.forward`, `inquiries.note`,
`inquiries.assign`, `inquiries.status`, `inquiries.priority`, `inquiries.tags`,
`inquiries.qualification.override`, `inquiries.lead_score.view`,
`inquiries.export`, `inquiries.delete`, `templates.manage`, `workflows.manage`,
`routing.manage`, `sla.manage`, `meetings.manage`, `analytics.view`,
`config.manage`.

`GET /platform/me` has no `x-permission` (session only).
`inquiries.lead_score.view` and `inquiries.delete` have no live routes yet;
they are listed on the enum for RBAC completeness.

## Idempotency and correlation

- Public submit **requires** body `idempotencyKey` (UUID). Replays return the
  original reference.
- `X-Request-Id` is optional; the server echoes it as `correlationId`.
- Header `Idempotency-Key` is documented for clients. The live submit handler
  does **not** read the header; it uses the body field. Planned DSAR export
  should honor the header.

## Pagination

Inbox list: `limit` (default 50, max 100), `offset` (default 0), response
`{ items, total, limit, offset }`. `total` is the SQL count before the
in-memory `readState` filter. Planned audit list uses the same page shape.

## Accuracy notes

- Inbox `hasMeeting` is always `false` in the current list handler.
- Platform Zod `.parse()` failures may surface as 500 today; the spec still
  documents 400 as the intended contract.
- Login cookie name is `ctx_platform_session`.
- Inquiry references match `CTX-YYYY-NNNNNN`.
