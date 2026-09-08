import { claimJobs, completeJob, releaseUnstartedJobs } from "./queue";

const workerId = process.env.CRM_MP_WORKER_ID ?? `ord-hold-${process.pid}`;
const marker = process.env.CRM_ORD_MARKER ?? "";
const holdMs = Number(process.env.CRM_ORD_HOLD_MS ?? 1500);

const jobs = await claimJobs(80, workerId);
const mine = jobs.filter((job) => job.payload.ordMarker === marker);
const extras = jobs.filter((job) => job.payload.ordMarker !== marker);
await releaseUnstartedJobs(extras, workerId);
process.stdout.write(`${JSON.stringify({ workerId, ids: mine.map((j) => j.id), types: mine.map((j) => j.type) })}\n`);
await new Promise((r) => setTimeout(r, Number.isFinite(holdMs) ? holdMs : 1500));
for (const job of mine) {
  await completeJob({ jobId: job.id, workerId, claimGeneration: job.claimGeneration });
}
process.exit(0);
