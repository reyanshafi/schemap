import { decryptSecret, newId, signWebhookPayload, tables, type RollbackJob } from "@schemap/core";
import type { Job } from "bullmq";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";
import { transition } from "../lib/transition";

const DELIVERY_TIMEOUT_MS = 30_000;

// Rollback webhook (docs/02 §4.9): lists idempotency keys of every delivered batch
// so the host can undo them. Must eventually succeed — retried by BullMQ.
export async function processRollback(job: Job<RollbackJob>): Promise<void> {
  const { importId } = job.data;

  const [imp] = await db
    .select()
    .from(tables.imports)
    .where(eq(tables.imports.id, importId))
    .limit(1);
  if (!imp) return;
  if (!["failed", "rolling_back", "cancelled"].includes(imp.status)) return;

  if (imp.status === "failed") {
    await transition(importId, imp.workspaceId, "failed", "rolling_back", {
      attempt: job.attemptsMade + 1,
    });
  }

  const delivered = await db
    .select({ key: tables.webhookDeliveries.idempotencyKey })
    .from(tables.webhookDeliveries)
    .where(
      and(
        eq(tables.webhookDeliveries.importId, importId),
        eq(tables.webhookDeliveries.type, "rows.batch"),
        eq(tables.webhookDeliveries.status, "succeeded"),
      ),
    );

  const [endpoint] = await db
    .select()
    .from(tables.webhookEndpoints)
    .where(
      and(
        eq(tables.webhookEndpoints.workspaceId, imp.workspaceId),
        eq(tables.webhookEndpoints.active, true),
      ),
    )
    .orderBy(asc(tables.webhookEndpoints.createdAt))
    .limit(1);

  if (delivered.length > 0 && endpoint) {
    const body = JSON.stringify({
      type: "import.rollback",
      import_id: importId,
      idempotency_keys: delivered.map((d) => d.key),
    });
    const secret = decryptSecret(endpoint.secretCiphertext).toString("utf8");
    const signature = signWebhookPayload(secret, body, Math.floor(Date.now() / 1000));

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Schemap-Signature": signature },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    }); // throws on network error → BullMQ retry
    if (!response.ok) throw new Error(`Rollback webhook got ${response.status}`);

    await db
      .insert(tables.webhookDeliveries)
      .values({
        id: newId("webhookDelivery"),
        workspaceId: imp.workspaceId,
        importId,
        endpointId: endpoint.id,
        type: "import.rollback",
        idempotencyKey: `${importId}:rollback`,
        payload: { idempotency_keys: delivered.map((d) => d.key) },
        status: "succeeded",
        attemptCount: job.attemptsMade + 1,
      })
      .onConflictDoNothing();
  }

  // cancelled imports stay cancelled; failed ones finish as rolled_back
  if (imp.status !== "cancelled") {
    await transition(importId, imp.workspaceId, "rolling_back", "rolled_back", {
      batches: delivered.length,
    });
  }
}
