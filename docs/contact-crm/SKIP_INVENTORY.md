# Skip inventory � current worktree `fwie` / branch `cursor/3b23f5cb`

Updated: 2026-09-03. STATUS remains **NOT READY FOR PRODUCTION**.

## CRM suite skips

| Test | Historical reason | Disposition |
|---|---|---|
| `listenBind.isolation.test.ts` | skipped without `CRM_VERIFY_LISTEN` | **Remediated** � always asserts PG `127.0.0.1:55432` |
| `migrationApply.deferred.test.ts` | skipped without `CRM_ALLOW_MIGRATE` | **Remediated** � non-destructive assert schema head = **0019** |

**CURRENT full suite:** `tmp/crm-suite-full-p12d.log` � **338 pass / 0 fail / 0 skip** (`node --import tsx --test src/lib/crm/*.test.ts`, PG `55432` / `claimtagx_crm_verify`, source `83ca53e`, 2026-09-03). Evidence class: local isolated.

**CURRENT full suite on restored DB:** see `tmp/crm-suite-restore-p12e.log` after dump `tmp/claimtagx-crm-verify/dump-p12.sql`.

## Browser Contact + Admin skips (current head)

| Browser | Log | Result | Skips |
|---|---|---|---|
| Chromium | `tmp/pw-chromium-p12g.log` | **ALL_OK** 88x5 | **0** |
| Firefox | `tmp/pw-firefox-p12d.log` | **ALL_OK** 88x5 | **0** |
| WebKit | `tmp/pw-webkit-p12.log` | **ALL_OK** 88x5 | **0** |

No retained capability skips under the configured local stack (`CRM_E2E_API` + `CRM_ADMIN_E2E=1`).

## Evidence class

Local isolated only (PG `55432`, API `18080`, Vite `5173`). Not production / Clerk / Graph live.
