import {
  bullConnectionFromUrl,
  jobId,
  QUEUE,
  type DeliverJob,
  type ParseJob,
  type RollbackJob,
  type ValidateJob,
} from "@schemap/core";
import { Queue } from "bullmq";

import { env } from "../env";

const connection = bullConnectionFromUrl(env.redisUrl);

const parseQueue = new Queue<ParseJob>(QUEUE.parse, { connection });
const validateQueue = new Queue<ValidateJob>(QUEUE.validate, { connection });
const deliverQueue = new Queue<DeliverJob>(QUEUE.deliver, { connection });
const rollbackQueue = new Queue<RollbackJob>(QUEUE.rollback, { connection });

export async function enqueueParse(importId: string): Promise<void> {
  await parseQueue.add(
    "parse",
    { importId },
    {
      jobId: jobId.parse(importId), // deterministic — double-enqueues collapse (docs/02 §5)
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
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

export async function enqueueDeliverBatches(importId: string, batchCount: number): Promise<void> {
  await deliverQueue.addBulk(
    Array.from({ length: batchCount }, (_, i) => ({
      name: "deliver",
      data: { importId, batchNo: i + 1 },
      opts: {
        jobId: jobId.deliver(importId, i + 1),
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    })),
  );
}

/** unique jobId per redrive — the original deterministic job may still exist */
export async function enqueueDeliverRedrive(importId: string, batchNo: number): Promise<void> {
  await deliverQueue.add(
    "deliver",
    { importId, batchNo },
    {
      jobId: `${jobId.deliver(importId, batchNo)}-r${Date.now()}`,
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

export async function closeQueues(): Promise<void> {
  await Promise.all([
    parseQueue.close(),
    validateQueue.close(),
    deliverQueue.close(),
    rollbackQueue.close(),
  ]);
}
