import {
  bullConnectionFromUrl,
  jobId,
  QUEUE,
  type ParseJob,
  type ValidateJob,
} from "@schemap/core";
import { Queue } from "bullmq";

import { env } from "../env";

const connection = bullConnectionFromUrl(env.redisUrl);

const parseQueue = new Queue<ParseJob>(QUEUE.parse, { connection });
const validateQueue = new Queue<ValidateJob>(QUEUE.validate, { connection });

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

export async function closeQueues(): Promise<void> {
  await Promise.all([parseQueue.close(), validateQueue.close()]);
}
