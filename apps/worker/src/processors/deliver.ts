import {
  decryptSecret,
  signWebhookPayload,
  tables,
  type DeliverJob,
  type RowError,
} from "@schemap/core";
import type { Job } from "bullmq";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "../db";
import { transition } from "../lib/transition";
import { enqueueRollback } from "../queues";

const DELIVERY_TIMEOUT_MS = 30_000;
const RESPONSE_BODY_CAP = 4096;

interface HostRowResult {
  _row: number;
  status: "ok" | "rejected";
  reason?: string;
}

async function recordAttempt(
  deliveryId: string,
  attemptNo: number,
  fields: { responseStatus?: number; responseBody?: string; error?: string; durationMs: number },
): Promise<void> {
  await db.insert(tables.webhookDeliveryAttempts).values({
    deliveryId,
    attemptNo,
    responseStatus: fields.responseStatus,
    responseBody: fields.responseBody?.slice(0, RESPONSE_BODY_CAP),
    error: fields.error,
    durationMs: fields.durationMs,
  });
  await db
    .update(tables.webhookDeliveries)
    .set({ attemptCount: attemptNo, updatedAt: new Date() })
    .where(eq(tables.webhookDeliveries.id, deliveryId));
}

export async function processDeliver(job: Job<DeliverJob>): Promise<void> {
  const { importId, batchNo } = job.data;
  const attemptNo = job.attemptsMade + 1;
  const isLastAttempt = attemptNo >= (job.opts.attempts ?? 1);

  const [imp] = await db
    .select()
    .from(tables.imports)
    .where(eq(tables.imports.id, importId))
    .limit(1);
  if (!imp || imp.status !== "importing") return; // cancelled/failed mid-flight → no-op

  const [delivery] = await db
    .select()
    .from(tables.webhookDeliveries)
    .where(
      and(
        eq(tables.webhookDeliveries.importId, importId),
        eq(tables.webhookDeliveries.type, "rows.batch"),
        eq(tables.webhookDeliveries.batchNo, batchNo),
      ),
    )
    .limit(1);
  if (!delivery || delivery.status === "succeeded") return; // idempotent retry

  const [endpoint] = await db
    .select()
    .from(tables.webhookEndpoints)
    .where(eq(tables.webhookEndpoints.id, delivery.endpointId))
    .limit(1);
  if (!endpoint) return;

  const rows = await db
    .select({ rowNo: tables.importRows.rowNo, data: tables.importRows.data })
    .from(tables.importRows)
    .where(
      and(
        eq(tables.importRows.importId, importId),
        eq(tables.importRows.batchNo, batchNo),
        inArray(tables.importRows.status, ["valid", "delivered"]),
      ),
    )
    .orderBy(asc(tables.importRows.rowNo));
  if (rows.length === 0) {
    await db
      .update(tables.webhookDeliveries)
      .set({ status: "succeeded", updatedAt: new Date() })
      .where(eq(tables.webhookDeliveries.id, delivery.id));
    await maybeComplete(importId, imp.workspaceId);
    return;
  }

  const body = JSON.stringify({
    type: "rows.batch",
    import_id: importId,
    batch_no: batchNo,
    idempotency_key: delivery.idempotencyKey,
    rows: rows.map((r) => ({ _row: r.rowNo, ...(r.data ?? {}) })),
  });
  const secret = decryptSecret(endpoint.secretCiphertext).toString("utf8");
  const signature = signWebhookPayload(secret, body, Math.floor(Date.now() / 1000));

  const started = Date.now();
  let response: Response;
  let responseText = "";
  try {
    response = await fetch(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Schemap-Signature": signature },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    responseText = await response.text();
  } catch (err) {
    await recordAttempt(delivery.id, attemptNo, {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    });
    if (isLastAttempt) await exhaust(delivery.id, imp, batchNo);
    throw err; // BullMQ retries with backoff
  }

  await recordAttempt(delivery.id, attemptNo, {
    responseStatus: response.status,
    responseBody: responseText,
    durationMs: Date.now() - started,
  });

  if (!response.ok) {
    if (isLastAttempt) await exhaust(delivery.id, imp, batchNo);
    throw new Error(`Host responded ${response.status} for batch ${batchNo}`);
  }

  // per-row accept/reject from the host (docs/02 §6); unparseable body = all accepted
  let results = new Map<number, HostRowResult>();
  try {
    const parsed = JSON.parse(responseText) as { results?: HostRowResult[] };
    results = new Map((parsed.results ?? []).map((r) => [r._row, r]));
  } catch {
    // lenient: 2xx with no parseable body means "all accepted"
  }

  const rejected = rows.filter((r) => results.get(r.rowNo)?.status === "rejected");
  const acceptedCount = rows.length - rejected.length;

  await db.transaction(async (tx) => {
    await tx
      .update(tables.importRows)
      .set({ status: "accepted" })
      .where(
        and(
          eq(tables.importRows.importId, importId),
          eq(tables.importRows.batchNo, batchNo),
          inArray(tables.importRows.status, ["valid", "delivered"]),
        ),
      );
    for (const row of rejected) {
      const reason = results.get(row.rowNo)?.reason ?? "rejected by host application";
      const error: RowError = { field: null, code: "host_rejected", message: reason };
      await tx
        .update(tables.importRows)
        .set({ status: "rejected", errors: [error] })
        .where(
          and(eq(tables.importRows.importId, importId), eq(tables.importRows.rowNo, row.rowNo)),
        );
    }
    await tx
      .update(tables.webhookDeliveries)
      .set({ status: "succeeded", updatedAt: new Date() })
      .where(eq(tables.webhookDeliveries.id, delivery.id));
    await tx
      .update(tables.imports)
      .set({
        deliveredCount: sql`${tables.imports.deliveredCount} + ${rows.length}`,
        acceptedCount: sql`${tables.imports.acceptedCount} + ${acceptedCount}`,
        rejectedCount: sql`${tables.imports.rejectedCount} + ${rejected.length}`,
        lastDeliveredBatch: batchNo,
        updatedAt: new Date(),
      })
      .where(eq(tables.imports.id, importId));
  });

  await maybeComplete(importId, imp.workspaceId);
}

/** delivery retries exhausted → import failed → rollback flow (docs/02 §12) */
async function exhaust(
  deliveryId: string,
  imp: { id: string; workspaceId: string },
  batchNo: number,
): Promise<void> {
  await db
    .update(tables.webhookDeliveries)
    .set({ status: "exhausted", updatedAt: new Date() })
    .where(eq(tables.webhookDeliveries.id, deliveryId));
  await db
    .update(tables.imports)
    .set({
      status: "failed",
      failureReason: {
        code: "delivery_failed",
        message: `Webhook delivery of batch ${batchNo} failed after all retries`,
      },
      updatedAt: new Date(),
    })
    .where(and(eq(tables.imports.id, imp.id), eq(tables.imports.status, "importing")));
  await db.insert(tables.importEvents).values({
    importId: imp.id,
    workspaceId: imp.workspaceId,
    fromStatus: "importing",
    toStatus: "failed",
    actor: "system",
    detail: { code: "delivery_failed", batchNo },
  });
  await enqueueRollback(imp.id);
}

async function maybeComplete(importId: string, workspaceId: string): Promise<void> {
  const [pending] = await db
    .select({ n: count() })
    .from(tables.webhookDeliveries)
    .where(
      and(
        eq(tables.webhookDeliveries.importId, importId),
        eq(tables.webhookDeliveries.type, "rows.batch"),
        ne(tables.webhookDeliveries.status, "succeeded"),
      ),
    );
  if ((pending?.n ?? 0) > 0) return;

  await transition(importId, workspaceId, "importing", "completed");
  await sendLifecycleWebhook(importId, workspaceId, "import.completed");
}

/** best-effort one-shot notification (import.completed) — no retry queue */
async function sendLifecycleWebhook(
  importId: string,
  workspaceId: string,
  type: "import.completed",
): Promise<void> {
  const [imp] = await db
    .select()
    .from(tables.imports)
    .where(eq(tables.imports.id, importId))
    .limit(1);
  const [endpoint] = await db
    .select()
    .from(tables.webhookEndpoints)
    .where(
      and(
        eq(tables.webhookEndpoints.workspaceId, workspaceId),
        eq(tables.webhookEndpoints.active, true),
      ),
    )
    .orderBy(asc(tables.webhookEndpoints.createdAt))
    .limit(1);
  if (!imp || !endpoint) return;

  const payload = {
    type,
    import_id: importId,
    counts: {
      rows: imp.rowCount,
      delivered: imp.deliveredCount,
      accepted: imp.acceptedCount,
      rejected: imp.rejectedCount,
      invalid: imp.invalidCount,
      excluded: imp.excludedCount,
    },
  };
  const body = JSON.stringify(payload);
  const secret = decryptSecret(endpoint.secretCiphertext).toString("utf8");
  const signature = signWebhookPayload(secret, body, Math.floor(Date.now() / 1000));
  try {
    await fetch(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Schemap-Signature": signature },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[worker] ${type} webhook failed for ${importId}:`, err);
  }
}
