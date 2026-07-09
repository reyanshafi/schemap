import { tables, type FailureReason, type ImportStatus } from "@schemap/core";
import { and, eq } from "drizzle-orm";

import { db } from "../db";

/** Status change + audit event in one transaction — the trail can't drift (docs/03 §4.4). */
export async function transition(
  importId: string,
  workspaceId: string,
  from: ImportStatus,
  to: ImportStatus,
  detail?: Record<string, unknown>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(tables.imports)
      .set({
        status: to,
        updatedAt: new Date(),
        ...(to === "completed" ? { completedAt: new Date() } : {}),
      })
      .where(and(eq(tables.imports.id, importId), eq(tables.imports.status, from)));
    await tx.insert(tables.importEvents).values({
      importId,
      workspaceId,
      fromStatus: from,
      toStatus: to,
      actor: "system",
      detail,
    });
  });
}

export async function failImport(
  importId: string,
  workspaceId: string,
  from: ImportStatus,
  reason: FailureReason,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(tables.imports)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(tables.imports.id, importId));
    await tx.insert(tables.importEvents).values({
      importId,
      workspaceId,
      fromStatus: from,
      toStatus: "failed",
      actor: "system",
      detail: { code: reason.code },
    });
  });
}
