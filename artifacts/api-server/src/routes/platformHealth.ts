import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { validateMicrosoftGraphConfig, graphProductionRequired } from "../lib/crm/microsoftGraph/config";
import { assertAttachmentStoreReadyForEnvironment } from "../lib/crm/attachmentStore";
import { assertExportStoreReady } from "../lib/crm/exportJobs";

const router: IRouter = Router();

router.get("/livez", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    if (graphProductionRequired()) {
      const graph = validateMicrosoftGraphConfig("production");
      if (!graph.ok) {
        res.status(503).json({ status: "unready", graph: graph.issues });
        return;
      }
    }
    try {
      assertAttachmentStoreReadyForEnvironment();
    } catch (err) {
      res.status(503).json({
        status: "unready",
        attachments: err instanceof Error ? err.message : "attachment store not ready",
      });
      return;
    }
    try {
      await assertExportStoreReady();
    } catch (err) {
      res.status(503).json({
        status: "unready",
        exports: err instanceof Error ? err.message : "export store not ready",
      });
      return;
    }
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unready" });
  }
});

export default router;
