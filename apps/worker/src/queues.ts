import {
  bullConnectionFromUrl,
  jobId,
  QUEUE,
  type DeliverJob,
  type MapJob,
  type ParseJob,
  type RollbackJob,
  type ValidateJob,
} from "@schemap/core";
import { Queue } from "bullmq";

import { env } from "./env";

export const connection = bullConnectionFromUrl(env.redisUrl);

// Producers the worker itself uses: chaining pipeline stages (map, rollback), and the
// reconciler resuming a stuck import by re-enqueueing with the SAME deterministic jobId
// the original producer used — BullMQ dedupes if that job still exists.
const parseQueue = new Queue<ParseJob>(QUEUE.parse, { connection });
export const mapQueue = new Queue<MapJob>(QUEUE.map, { connection });
const validateQueue = new Queue<ValidateJob>(QUEUE.validate, { connection });
const deliverQueue = new Queue<DeliverJob>(QUEUE.deliver, { connection });
const rollbackQueue = new Queue<RollbackJob>(QUEUE.rollback, { connection });
const cleanupQueue = new Queue(QUEUE.cleanup, { connection });

/** Repeatable cleanup/reconciler job — idempotent to call on every worker boot. */
export async function scheduleCleanup(everyMs: number): Promise<void> {
  await cleanupQueue.upsertJobScheduler(
    "cleanup-cron",
    { every: everyMs },
    { name: "cleanup", opts: { removeOnComplete: 20, removeOnFail: 20 } },
  );
}

export async function enqueueParse(importId: string): Promise<void> {
  await parseQueue.add(
    "parse",
    { importId },
    {
      jobId: jobId.parse(importId),
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
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

export async function enqueueValidate(importId: string): Promise<void> {
  await validateQueue.add(
    "validate",
    { importId },
    {
      jobId: jobId.validate(importId),
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
}

export async function enqueueDeliver(importId: string, batchNo: number): Promise<void> {
  await deliverQueue.add(
    "deliver",
    { importId, batchNo },
    {
      jobId: jobId.deliver(importId, batchNo),
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
}

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

export async function closeProducers(): Promise<void> {
  await Promise.all([
    parseQueue.close(),
    mapQueue.close(),
    validateQueue.close(),
    deliverQueue.close(),
    rollbackQueue.close(),
    cleanupQueue.close(),
  ]);
}
