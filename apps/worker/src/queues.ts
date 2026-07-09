import { bullConnectionFromUrl, jobId, QUEUE, type MapJob, type RollbackJob } from "@schemap/core";
import { Queue } from "bullmq";

import { env } from "./env";

export const connection = bullConnectionFromUrl(env.redisUrl);

// producers the worker itself uses to chain pipeline stages
export const mapQueue = new Queue<MapJob>(QUEUE.map, { connection });
const rollbackQueue = new Queue<RollbackJob>(QUEUE.rollback, { connection });

export async function enqueueRollback(importId: string): Promise<void> {
  await rollbackQueue.add(
    "rollback",
    { importId },
    {
      jobId: jobId.rollback(importId),
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
}

export async function enqueueMap(importId: string): Promise<void> {
  await mapQueue.add(
    "map",
    { importId },
    {
      jobId: jobId.map(importId),
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
}

export async function closeProducers(): Promise<void> {
  await Promise.all([mapQueue.close(), rollbackQueue.close()]);
}
