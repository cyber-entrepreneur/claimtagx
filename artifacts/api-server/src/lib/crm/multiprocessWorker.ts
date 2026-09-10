import { claimJobs, completeJob } from "./queue";

const workerId = process.env.CRM_MP_WORKER_ID ?? `mp-${process.pid}`;

const jobs = await claimJobs(5, workerId);
const sleep = jobs.filter((job) => job.type === "__test_sleep");
process.stdout.write(`claimed=${sleep.length} worker=${workerId}\n`);
for (const job of sleep) {
  await new Promise((r) => setTimeout(r, 50));
  await completeJob({ jobId: job.id, workerId, claimGeneration: job.claimGeneration });
}
process.exit(0);
