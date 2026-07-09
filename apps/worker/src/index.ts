import "./env"; // load .env before anything reads process.env

import { QUEUE, WORKER_CONCURRENCY, type QueueName } from "@schemap/core";
import { Worker, type Job } from "bullmq";

import { processParse } from "./processors/parse";
import { closeProducers, connection } from "./queues";

// Phase 4+ fills in map, validate, deliver, rollback, cleanup.
async function notImplemented(job: Job): Promise<void> {
  console.log(`[worker] ${job.queueName}:${job.id} received — processor not implemented yet`);
}

const processors: Partial<Record<QueueName, (job: Job) => Promise<void>>> = {
  [QUEUE.parse]: processParse,
};

const workers = (Object.values(QUEUE) as QueueName[]).map(
  (queueName) =>
    new Worker(queueName, processors[queueName] ?? notImplemented, {
      connection,
      concurrency: WORKER_CONCURRENCY[queueName],
    }),
);

for (const worker of workers) {
  worker.on("ready", () => console.log(`[worker] queue "${worker.name}" ready`));
  worker.on("completed", (job) => console.log(`[worker] ${worker.name}:${job.id} completed`));
  worker.on("failed", (job, err) =>
    console.error(`[worker] ${worker.name}:${job?.id} failed:`, err.message),
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received, closing workers`);
  await Promise.all([...workers.map((w) => w.close()), closeProducers()]);
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}
