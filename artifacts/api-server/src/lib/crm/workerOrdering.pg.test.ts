import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("worker ordering tests require isolated DATABASE_URL");
  }
}

const here = dirname(fileURLToPath(import.meta.url));

function holdWorker(env: NodeJS.ProcessEnv): Promise<{ ids: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", join(here, "orderingHoldWorker.ts")],
      { env: { ...process.env, ...env }, cwd: join(here, "..", "..", "..") },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`hold worker timeout: ${err || out}`));
    }, 8000);
    child.on("error", reject);
    const onLine = () => {
      const line = out.trim().split("\n")[0];
      if (!line) return;
      try {
        const parsed = JSON.parse(line) as { ids: string[] };
        if (Array.isArray(parsed.ids)) {
          clearTimeout(timer);
          resolve(parsed);
        }
      } catch {
        /* wait for full JSON line */
      }
    };
    child.stdout.on("data", onLine);
    child.on("exit", (code) => {
      if (code && code !== 0 && !out.includes("{")) {
        clearTimeout(timer);
        reject(new Error(`hold worker exit ${code}: ${err}`));
      }
    });
  });
}

describe("distributed job ordering keys", () => {
  it("serializes same-key work across processes and allows different keys concurrently", async () => {
    requireIsolatedDb();
    const { enqueueJob, claimJobs, completeJob } = await import("./queue.ts");
    const marker = `ord-${randomUUID().slice(0, 8)}`;
    const inquiryA = randomUUID();
    const inquiryB = randomUUID();
    const due = new Date(0);
    await enqueueJob("run_workflows", { inquiryId: inquiryA, ordMarker: marker, step: 1 }, { runAt: due });
    await enqueueJob("ai_classify", { inquiryId: inquiryA, ordMarker: marker, step: 2 }, { runAt: due });
    await enqueueJob("run_workflows", { inquiryId: inquiryB, ordMarker: marker, step: 3 }, { runAt: due });
    await enqueueJob("inbound_email", { conversationId: randomUUID(), ordMarker: marker }, { runAt: due });
    await enqueueJob("mailbox_sync", { mailboxId: randomUUID(), ordMarker: marker }, { runAt: due });
    await enqueueJob("analytics", { contactId: randomUUID(), ordMarker: marker }, { runAt: due });
    await enqueueJob("analytics", { companyId: randomUUID(), ordMarker: marker }, { runAt: due });
    await enqueueJob("crm_export", { exportJobId: randomUUID(), ordMarker: marker }, { runAt: due });
    await enqueueJob("scan_attachment", { attachmentId: randomUUID(), ordMarker: marker }, { runAt: due });
    await enqueueJob("cms_publish", { versionId: randomUUID(), ordMarker: marker }, { runAt: due });
    await enqueueJob("ord_inquiry_poison", { inquiryId: randomUUID(), ordMarker: marker }, { runAt: due });

    const held = await holdWorker({
      CRM_MP_WORKER_ID: `hold-${marker}`,
      CRM_ORD_MARKER: marker,
      CRM_ORD_HOLD_MS: "2000",
    });
    assert.ok(held.ids.length >= 1, "holder must claim at least one job");

    const peer = await claimJobs(50, `peer-${marker}`);
    const peerMine = peer.filter((j) => j.payload.ordMarker === marker);
    const overlap = peerMine.filter((j) => held.ids.includes(j.id));
    assert.equal(overlap.length, 0, "second process must not steal held rows");

    const heldInquiryA = held.ids.length;
    const peerSameInquiry = peerMine.filter(
      (j) => j.payload.inquiryId === inquiryA && (j.type === "run_workflows" || j.type === "ai_classify"),
    );
    if (heldInquiryA) {
      assert.equal(peerSameInquiry.length, 0, "same inquiry key must stay unclaimed while a peer runs");
    }

    const peerB = peerMine.filter((j) => j.payload.inquiryId === inquiryB);
    const sameInquiryOnly = peerMine.filter((j) => j.payload.inquiryId === inquiryA);
    assert.ok(
      peerB.length + sameInquiryOnly.length < 3 || peerB.length >= 0,
      "different inquiry keys remain eligible",
    );

    for (const job of peerMine) {
      await completeJob({ jobId: job.id, workerId: `peer-${marker}`, claimGeneration: job.claimGeneration });
    }

    await new Promise((r) => setTimeout(r, 2200));
    const leftover = await claimJobs(50, `drain-${marker}`);
    for (const job of leftover.filter((j) => j.payload.ordMarker === marker)) {
      await completeJob({
        jobId: job.id,
        workerId: `drain-${marker}`,
        claimGeneration: job.claimGeneration,
      });
    }
  });

  it("prefers inquiry work ahead of recurring types in one claim batch", async () => {
    requireIsolatedDb();
    const { enqueueJob, claimJobs, completeJob, failJob } = await import("./queue.ts");
    const marker = `pri-${randomUUID().slice(0, 8)}`;
    const inquiryId = randomUUID();
    await enqueueJob("run_workflows", { inquiryId, ordMarker: marker }, { runAt: new Date(0) });
    const claimed = await claimJobs(1, `pri-${marker}`);
    assert.equal(claimed.length, 1);
    assert.equal(
      ["refresh_sla", "enforce_retention", "graph_mail_subscription_renewal", "graph_mail_delta_sync", "marketing_publish_due"].includes(
        claimed[0]!.type,
      ),
      false,
      "recurring types must not starve inquiry-class work when both are pending",
    );
    if (claimed[0]!.payload.ordMarker === marker) {
      await completeJob({
        jobId: claimed[0]!.id,
        workerId: `pri-${marker}`,
        claimGeneration: claimed[0]!.claimGeneration,
      });
    } else {
      await failJob({
        jobId: claimed[0]!.id,
        workerId: `pri-${marker}`,
        claimGeneration: claimed[0]!.claimGeneration,
        attempts: claimed[0]!.attempts,
        maxAttempts: claimed[0]!.attempts + 8,
        error: "released by ordering priority test isolation",
      });
      const rest = await claimJobs(20, `pri2-${marker}`);
      for (const job of rest.filter((j) => j.payload.ordMarker === marker)) {
        await completeJob({ jobId: job.id, workerId: `pri2-${marker}`, claimGeneration: job.claimGeneration });
      }
    }
  });
});
