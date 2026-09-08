/**
 * Dedicated CRM background worker process.
 * Run separately from the HTTP API in every non-local environment:
 *   node --enable-source-maps ./dist/worker.mjs
 */
import { assertProductionSecurity } from "./lib/crm/authFlags";
import { logger } from "./lib/logger";
import { startCrmJobWorker } from "./lib/crm/jobs";

assertProductionSecurity();

const e2eRunId = process.env.CRM_E2E_RUN_ID?.trim();
if (e2eRunId) {
  process.title = `ctx-e2e-worker-${e2eRunId.slice(0, 12)}`;
}

if (!process.env.CRM_WORKER_EXIT_ON_SHUTDOWN) {
  process.env.CRM_WORKER_EXIT_ON_SHUTDOWN = "true";
}

logger.info("Starting ClaimTagX CRM worker");
startCrmJobWorker({ bindSignals: true });
