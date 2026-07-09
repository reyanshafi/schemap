import { bullConnectionFromUrl, jobId, QUEUE, type ParseJob } from "@schemap/core";
import { Queue } from "bullmq";

import { env } from "../env";

const connection = bullConnectionFromUrl(env.redisUrl);

const parseQueue = new Queue<ParseJob>(QUEUE.parse, { connection });

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

export async function closeQueues(): Promise<void> {
  await parseQueue.close();
}
