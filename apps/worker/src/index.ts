import { fileURLToPath } from "node:url";

import { QUEUE, WORKER_CONCURRENCY, type QueueName } from "@schemap/core";
import { Worker, type Job } from "bullmq";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

// Pass options, not an ioredis instance — BullMQ manages its own connections
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.password ? { password: redisUrl.password } : {}),
  maxRetriesPerRequest: null, // BullMQ requirement
};

// Phase 3+ replaces these with real processors (parse, map, validate, deliver, rollback, cleanup).
// Every processor must re-read import state from Postgres and no-op if it already moved on (docs/02 §5).
async function notImplemented(job: Job): Promise<void> {
  console.log(`[worker] ${job.queueName}:${job.id} received — processor not implemented yet`);
}

const workers = (Object.values(QUEUE) as QueueName[]).map(
  (queueName) =>
    new Worker(queueName, notImplemented, {
      connection,
      concurrency: WORKER_CONCURRENCY[queueName],
    }),
);

for (const worker of workers) {
  worker.on("ready", () => console.log(`[worker] queue "${worker.name}" ready`));
  worker.on("failed", (job, err) =>
    console.error(`[worker] ${worker.name}:${job?.id} failed:`, err.message),
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received, closing workers`);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}
