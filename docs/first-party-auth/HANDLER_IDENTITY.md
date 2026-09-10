# Handler identity after first-party auth

The Handler app now authenticates against the **same first-party session** as
the CRM (Platform Admin). Hosted identity-provider dependencies have been
removed from the API and the Handler identity path.

## What `handler_user_id` stores now

- `req.userId` (set by `middlewares/requireAuth.ts`) is the **first-party auth
  account id** — a stable, opaque string minted by `@workspace/first-party-auth`.
- Rows written after this change store that first-party account id in
  `handler_venues.handler_user_id` (and the related `intercom_presence.handler_user_id`,
  `intercom_transmissions.sender_user_id`, `venue_invitations.invited_by_user_id`,
  `venue_invitations.accepted_by_user_id`, `events.*` owner references).
- Historical ids in those columns are treated as opaque strings until a
  one-time data migration maps them onto first-party accounts. Nothing in the
  code special-cases the id format, so mixed old/new ids coexist safely; a
  handler who signs in with a new first-party account simply creates a new
  membership row. Migrating historical memberships to the corresponding
  first-party account is a separate data task and is **not** performed here.

## One identity system, two surfaces

- The shared session cookie is `ctx_auth_session` (HttpOnly, Secure,
  `SameSite=None` in production, `path=/`). It carries an **opaque refresh
  token**; only its hash is persisted.
- Non-browser Handler API clients may instead send an opaque
  `Authorization: Bearer` access (or refresh) token.
- Both CRM (`requirePlatformAdmin`) and Handler (`requireAuth`) resolve identity
  through the same `resolvePrincipal()` helper
  (`middlewares/requireAuthSession.ts`), so a single sign-in serves both.

## Where display names / emails come from

External user-profile lookups have been replaced by the account's verified
email from the auth platform
(`getAuthService().getAccountEmail(accountId)`):

- `routes/invitations.ts` — inviter identity + member roster enrichment.
- `lib/tamperAlerts.ts` — venue owner emails for spike alerts.

Display name is derived from the email local-part (there is no separate profile
store in the auth core; profile data is a host concern).

## Establishing a Handler session

Handlers sign in via the shared first-party endpoints under `/platform/auth/*`
(e.g. `POST /platform/auth/login`). There is no Handler-specific login UI
dependency on a hosted identity provider. A handler-only account (no linked
`crm_staff` row) receives a valid session cookie and `staff: null` in the login
response.
