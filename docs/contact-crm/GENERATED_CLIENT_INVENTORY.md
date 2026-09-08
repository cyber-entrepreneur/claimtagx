# Generated-client operation inventory (authorized Contact CRM scope)

Generated from `lib/api-client-react/src/contact-crm.ts` plus UI imports. Not a frozen same-head gate.

Remaining handwritten wrappers: none in admin pages. `contactApi.ts` keeps generated-client error mapping for public Contact submit/login only. Documented download exception: `GET /api/platform/contact/exports/{id}/download` via `window.location.assign`.

| operationId | method | path | generated function | current consumer |
| --- | --- | --- | --- | --- |
| getContactBootstrap | GET | /contact/bootstrap | getContactBootstrap | Contact.tsx via contactApi |
| submitContactInquiry | POST | /contact/inquiries | submitContactInquiry | Contact.tsx via contactApi |
| getPlatformMe | GET | /platform/me | getPlatformMe | Admin shell |
| platformAuthLogin | POST | /platform/auth/login | platformAuthLogin | contactApi.platformLogin (dev) |
| platformAuthLogout | POST | /platform/auth/logout | platformAuthLogout | Admin |
| listPlatformContactInquiries | GET | /platform/contact/inquiries | listPlatformContactInquiries | Inbox.tsx |
| getPlatformContactInquiry | GET | /platform/contact/inquiries/{id} | getPlatformContactInquiry | InquiryWorkspace.tsx |
| getPlatformContactAnalytics | GET | /platform/contact/analytics | getPlatformContactAnalytics | Analytics.tsx |
| createPlatformContactExport | POST | /platform/contact/exports | createPlatformContactExport | Analytics.tsx |
| getPlatformContactExport | GET | /platform/contact/exports/{id} | getPlatformContactExport | Analytics.tsx |
| cancelPlatformContactExport | POST | /platform/contact/exports/{id}/cancel | cancelPlatformContactExport | Analytics.tsx |
| downloadPlatformContactExport | GET | /platform/contact/exports/{id}/download | getDownloadPlatformContactExportUrl | Analytics.tsx navigation exception |
| listPlatformAttachments | GET | /platform/contact/attachments | listPlatformAttachments | Attachments.tsx |
| releasePlatformAttachmentQuarantine | POST | /platform/contact/attachments/{id}/release-quarantine | releasePlatformAttachmentQuarantine | Attachments.tsx |
| listPlatformMarketingDocuments | GET | /platform/marketing/documents | (generated) | Marketing.tsx |
| getPlatformContactConfig | GET | /platform/contact/config | (generated) | Config.tsx |
| listPlatformContactJobs | GET | /platform/contact/jobs | (generated) | Operations.tsx |

All other `CONTACT_CRM_OPERATIONS` IDs are generated in `contact-generated/api.ts`. Full list is in `contact-crm.ts` (including DSAR, CMS transitions, locks, presence, governance). Admin mutations call generated functions directly. The only documented non-JSON exception is download navigation.

OpenAPI extra fields added this cycle: `ContactBootstrap.botProtection`, `ContactSubmitRequest.botProof`, submit `503`.
