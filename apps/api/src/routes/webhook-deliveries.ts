import { tables } from "@schemap/core";
import { and, asc, desc, eq } from "drizzle-orm";
import { Router } from "express";

import { db } from "../db";
import { AppError } from "../errors";
import { enqueueDeliverRedrive } from "../lib/queues";
import { requireWorkspaceAuth } from "../middleware/auth";

// The webhook debugger (docs/02 §6): every delivery + every attempt, redrivable.

export const webhookDeliveriesRouter = Router();
webhookDeliveriesRouter.use(requireWorkspaceAuth);

webhookDeliveriesRouter.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  const importId = typeof req.query.importId === "string" ? req.query.importId : null;

  const deliveries = await db
    .select({
      id: tables.webhookDeliveries.id,
      importId: tables.webhookDeliveries.importId,
      type: tables.webhookDeliveries.type,
      batchNo: tables.webhookDeliveries.batchNo,
      idempotencyKey: tables.webhookDeliveries.idempotencyKey,
      status: tables.webhookDeliveries.status,
      attemptCount: tables.webhookDeliveries.attemptCount,
      endpointUrl: tables.webhookEndpoints.url,
      createdAt: tables.webhookDeliveries.createdAt,
      updatedAt: tables.webhookDeliveries.updatedAt,
    })
    .from(tables.webhookDeliveries)
    .innerJoin(
      tables.webhookEndpoints,
      eq(tables.webhookEndpoints.id, tables.webhookDeliveries.endpointId),
    )
    .where(
      and(
        eq(tables.webhookDeliveries.workspaceId, req.auth!.workspaceId),
        ...(importId ? [eq(tables.webhookDeliveries.importId, importId)] : []),
      ),
    )
    .orderBy(desc(tables.webhookDeliveries.createdAt))
    .limit(limit);
  res.json({ deliveries });
});

async function loadDelivery(workspaceId: string, id: string) {
  const [delivery] = await db
    .select()
    .from(tables.webhookDeliveries)
    .where(
      and(eq(tables.webhookDeliveries.id, id), eq(tables.webhookDeliveries.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!delivery) throw new AppError(404, "not_found", "Delivery not found");
  return delivery;
}

webhookDeliveriesRouter.get("/:id", async (req, res) => {
  const delivery = await loadDelivery(req.auth!.workspaceId, req.params.id);
  const attempts = await db
    .select({
      attemptNo: tables.webhookDeliveryAttempts.attemptNo,
      responseStatus: tables.webhookDeliveryAttempts.responseStatus,
      responseBody: tables.webhookDeliveryAttempts.responseBody,
      error: tables.webhookDeliveryAttempts.error,
      durationMs: tables.webhookDeliveryAttempts.durationMs,
      createdAt: tables.webhookDeliveryAttempts.createdAt,
    })
    .from(tables.webhookDeliveryAttempts)
    .where(eq(tables.webhookDeliveryAttempts.deliveryId, delivery.id))
    .orderBy(asc(tables.webhookDeliveryAttempts.attemptNo));
  res.json({ delivery, attempts });
});

// re-send a stuck/failed batch, e.g. after the host fixed their endpoint
webhookDeliveriesRouter.post("/:id/redrive", async (req, res) => {
  const delivery = await loadDelivery(req.auth!.workspaceId, req.params.id);
  if (delivery.type !== "rows.batch" || delivery.batchNo === null) {
    throw new AppError(400, "not_redrivable", "Only rows.batch deliveries can be redriven");
  }
  if (delivery.status === "succeeded") {
    throw new AppError(409, "already_delivered", "This batch was already delivered");
  }

  const [imp] = await db
    .select()
    .from(tables.imports)
    .where(eq(tables.imports.id, delivery.importId))
    .limit(1);
  if (!imp) throw new AppError(404, "not_found", "Import not found");
  if (!["importing", "failed"].includes(imp.status)) {
    throw new AppError(
      409,
      "invalid_state",
      `Import is "${imp.status}" — redrive only applies while importing or after a delivery failure`,
    );
  }

  await db.transaction(async (tx) => {
    if (imp.status === "failed") {
      // delivery failure sank the import; redrive revives it
      await tx
        .update(tables.imports)
        .set({ status: "importing", failureReason: null, updatedAt: new Date() })
        .where(eq(tables.imports.id, imp.id));
      await tx.insert(tables.importEvents).values({
        importId: imp.id,
        workspaceId: imp.workspaceId,
        fromStatus: "failed",
        toStatus: "importing",
        actor: "dashboard",
        detail: { redrive: true, batchNo: delivery.batchNo },
      });
    }
    await tx
      .update(tables.webhookDeliveries)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(tables.webhookDeliveries.id, delivery.id));
  });

  await enqueueDeliverRedrive(delivery.importId, delivery.batchNo);
  res.json({ ok: true, delivery: { id: delivery.id, status: "pending" } });
});
