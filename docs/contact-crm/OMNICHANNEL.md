# Omnichannel inbox connectors

Official adapters only. No scraping, unofficial APIs, shared passwords, or cookie extraction.

Simulators and fixture injection are never labeled `LIVE_VERIFIED`.

## Channel status model

- `LIVE_VERIFIED` — real provider test passed
- `IMPLEMENTED_AWAITING_CREDENTIALS` — adapter complete, credentials/admin consent outstanding
- `BLOCKED_APP_REVIEW` — set `CRM_CHANNEL_<CHANNEL>_APP_REVIEW=true` or `META_APP_REVIEW=true` / `WHATSAPP_APP_REVIEW=true`
- `PARTNER_GATED` — LinkedIn private messaging without approved partner access
- `UNSUPPORTED_BY_PUBLIC_API` — TikTok customer-support DMs
- `DISABLED` — `CRM_CHANNEL_<CHANNEL>_DISABLED=true`

## Environment variables

### Website Contact
No extra secrets. Public form: `POST /api/contact/inquiries`.

### Microsoft Graph
`MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` or certificate pair, `MS_GRAPH_MAILBOX_UPN`, `MS_GRAPH_NOTIFICATION_URL`, `MS_GRAPH_CLIENT_STATE`, `MS_GRAPH_DELTA_ENCRYPTION_KEY`.

Webhook: `POST /api/contact/webhooks/microsoft-graph/mail`.

Do not set `CRM_GRAPH_LIVE_VERIFIED=true` until a real tenant round-trip succeeds.

### WhatsApp Cloud API
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.

Webhook: `GET|POST /api/contact/webhooks/whatsapp`.

### Facebook Messenger / Instagram
`META_APP_SECRET`, `META_VERIFY_TOKEN`, `MESSENGER_PAGE_ACCESS_TOKEN` and/or `INSTAGRAM_PAGE_ACCESS_TOKEN` (or `META_PAGE_ACCESS_TOKEN`).

Webhook: `GET|POST /api/contact/webhooks/meta` (`object=page` or `object=instagram`).

### X
`X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`. Account Activity CRC is handled on `GET /api/contact/webhooks/x`.

### TikTok
No public support DM API. Manual handoff: https://www.tiktok.com/messages

### LinkedIn
Private messaging is partner-gated. Manual handoff: https://www.linkedin.com/messaging/

## Production refusals

Forbidden: `CRM_CHANNEL_SIMULATOR`, `CRM_GRAPH_SIMULATOR`, `CRM_EMAIL_SIMULATOR`, `CRM_ALLOW_TEST_JOBS`, `CRM_BOT_ADAPTER=simulator` or `honeypot_only`.
Memory attachment storage is forbidden in production.
