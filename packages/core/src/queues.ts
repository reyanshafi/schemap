// Queue topology — names, payloads, concurrency, deterministic job ids (docs/02 §5).
// Shared so the API (producer) and worker (consumer) can never drift.

export const QUEUE = {
  parse: "parse",
  map: "map",
  validate: "validate",
  deliver: "deliver",
  rollback: "rollback",
  cleanup: "cleanup",
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface ParseJob {
  importId: string;
}
export interface MapJob {
  importId: string;
}
export interface ValidateJob {
  importId: string;
}
export interface DeliverJob {
  importId: string;
  batchNo: number;
}
export interface RollbackJob {
  importId: string;
}
export type CleanupJob = Record<string, never>; // cron-scheduled sweep, no payload

export const WORKER_CONCURRENCY: Record<QueueName, number> = {
  parse: 2, // CPU/IO heavy
  map: 5, // rate-limit aware; cache-first
  validate: 2,
  deliver: 10,
  rollback: 5,
  cleanup: 1,
};

// Deterministic job ids: accidental double-enqueues collapse into one job.
// "-" separator — BullMQ reserves ":" in custom job ids.
export const jobId = {
  parse: (importId: string) => `parse-${importId}`,
  map: (importId: string) => `map-${importId}`,
  validate: (importId: string) => `validate-${importId}`,
  deliver: (importId: string, batchNo: number) => `deliver-${importId}-${batchNo}`,
  rollback: (importId: string) => `rollback-${importId}`,
} as const;

/** BullMQ connection options from a redis:// URL (both API producer and worker consumer use this). */
export function bullConnectionFromUrl(redisUrl: string): {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
} {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null, // BullMQ requirement
  };
}
