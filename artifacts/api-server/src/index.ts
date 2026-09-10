import app from "./app";
import { logger } from "./lib/logger";
import { startCrmJobWorker, shutdownCrmJobWorker } from "./lib/crm/jobs";
import { resolveListenHost } from "./lib/crm/listenHost";
import { assertProductionSecurity } from "./lib/crm/authFlags";
import type { Server } from "node:http";

assertProductionSecurity();

const e2eRunId = process.env.CRM_E2E_RUN_ID?.trim();
if (e2eRunId) {
  process.title = `ctx-e2e-api-${e2eRunId.slice(0, 12)}`;
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const host = resolveListenHost(process.env);

const embedWorker =
  process.env.CRM_EMBED_WORKER === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.CRM_EMBED_WORKER !== "false");

const server: Server = app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host }, "Server listening");
  if (embedWorker) {
    logger.warn(
      "Embedding CRM worker in API process (dev only). Production must run dist/worker.mjs separately.",
    );
    startCrmJobWorker({ bindSignals: false });
  } else {
    logger.info("CRM worker not embedded; start the dedicated worker process");
  }
});

let apiShutdownBound = false;
function onApiShutdown() {
  server.close();
  void shutdownCrmJobWorker().then((code) => {
    process.exit(code);
  });
}
if (!apiShutdownBound) {
  process.on("SIGTERM", onApiShutdown);
  process.on("SIGINT", onApiShutdown);
  apiShutdownBound = true;
}
