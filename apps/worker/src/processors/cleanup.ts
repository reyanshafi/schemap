import { createStorage, tables, TRANSIENT_IMPORT_STATUSES } from "@schemap/core";
import type { Job } from "bullmq";
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "../db";
import { enqueueDeliver, enqueueMap, enqueueParse, enqueueRollback, enqueueValidate } from "../queues";

const storage = createStorage();
const ORPHAN_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const TERMINAL_IMPORT_STATUSES = ["completed", "failed", "rolled_back", "cancelled"] as const;
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // an import sitting in a transient state this long is stuck
const ROW_PURGE_BATCH = 10_000;

/** never-consumed uploads: delete the file + row after 24h (docs/03 §7) */
async function purgeOrphanUploads(): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_UPLOAD_TTL_MS);
  const orphans = await db
    .select({ id: tables.uploads.id, storageKey: tables.uploads.storageKey })
    .from(tables.uploads)
    .where(and(isNull(tables.uploads.consumedByImportId), lt(tables.uploads.createdAt, cutoff)))
    .limit(500);

  for (const upload of orphans) {
    await storage.deleteObject(upload.storageKey).catch(() => {});
    await db.delete(tables.uploads).where(eq(tables.uploads.id, upload.id));
  }
  return orphans.length;
}

/** consumed uploads past the workspace's retention window: delete just the raw file */
async function purgeRetainedFiles(): Promise<number> {
  const due = await db
    .select({ id: tables.uploads.id, storageKey: tables.uploads.storageKey })
    .from(tables.uploads)
    .where(
      and(
        sql`${tables.uploads.consumedByImportId} is not null`,
        lt(tables.uploads.deleteAfter, new Date()),
        isNull(tables.uploads.storageDeletedAt),
      ),
    )
    .limit(500);

  for (const upload of due) {
    await storage.deleteObject(upload.storageKey).catch(() => {});
    await db
      .update(tables.uploads)
      .set({ storageDeletedAt: new Date() })
      .where(eq(tables.uploads.id, upload.id));
  }
  return due.length;
}

/** staging rows of terminal imports past retention — the file becomes read-once (docs/03 §7) */
async function purgeStagingRows(): Promise<number> {
  const candidates = await db
    .select({
      id: tables.imports.id,
      completedAt: tables.imports.completedAt,
      updatedAt: tables.imports.updatedAt,
      retentionDays: tables.workspaces.retentionDays,
    })
    .from(tables.imports)
    .innerJoin(tables.workspaces, eq(tables.workspaces.id, tables.imports.workspaceId))
    .where(
      and(
        inArray(tables.imports.status, TERMINAL_IMPORT_STATUSES),
        sql`exists (select 1 from import_rows where import_rows.import_id = ${tables.imports.id})`,
      ),
    )
    .limit(200);

  let purged = 0;
  for (const imp of candidates) {
    const finishedAt = imp.completedAt ?? imp.updatedAt;
    const dueAt = new Date(finishedAt.getTime() + imp.retentionDays * 24 * 60 * 60 * 1000);
    if (dueAt > new Date()) continue;

    // batched deletes so a 250k-row import never locks the table in one giant transaction
    for (;;) {
      const result = await db.execute(
        sql`delete from import_rows where ctid in (
          select ctid from import_rows where import_id = ${imp.id} limit ${ROW_PURGE_BATCH}
        )`,
      );
      if (!result.rowCount) break;
      purged += result.rowCount;
      if (result.rowCount < ROW_PURGE_BATCH) break;
    }
  }
  return purged;
}

/** expired dashboard sessions */
async function purgeExpiredSessions(): Promise<number> {
  const result = await db.delete(tables.sessions).where(lt(tables.sessions.expiresAt, new Date()));
  return result.rowCount ?? 0;
}

/** cache entries whose schema has since moved to a newer version (docs/03 §4.5) */
async function purgeStaleMappingCache(): Promise<number> {
  const result = await db.execute(sql`
    delete from mapping_cache
    using schemas
    where mapping_cache.schema_id = schemas.id
      and mapping_cache.schema_version <> schemas.version
  `);
  return result.rowCount ?? 0;
}

/**
 * Imports parked in a transient state past a stuck-threshold: crash-safe resume by
 * re-enqueueing the stage's job with its deterministic id (docs/02 §12: "Redis lost ->
 * queues rebuild ... by a reconciler cron that finds imports stuck in transient states").
 */
async function reconcileStuckImports(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuck = await db
    .select({ id: tables.imports.id, status: tables.imports.status })
    .from(tables.imports)
    .where(
      and(
        inArray(tables.imports.status, TRANSIENT_IMPORT_STATUSES),
        lt(tables.imports.updatedAt, cutoff),
      ),
    )
    .limit(200);

  for (const imp of stuck) {
    switch (imp.status) {
      case "parsing":
        await enqueueParse(imp.id);
        break;
      case "mapping":
        await enqueueMap(imp.id);
        break;
      case "validating":
        await enqueueValidate(imp.id);
        break;
      case "rolling_back":
        await enqueueRollback(imp.id);
        break;
      case "importing": {
        const pending = await db
          .select({ batchNo: tables.webhookDeliveries.batchNo })
          .from(tables.webhookDeliveries)
          .where(
            and(
              eq(tables.webhookDeliveries.importId, imp.id),
              eq(tables.webhookDeliveries.type, "rows.batch"),
              ne(tables.webhookDeliveries.status, "succeeded"),
            ),
          );
        for (const p of pending) {
          if (p.batchNo !== null) await enqueueDeliver(imp.id, p.batchNo);
        }
        break;
      }
    }
  }
  return stuck.length;
}

export async function processCleanup(_job: Job): Promise<void> {
  const results = {
    orphanUploads: await purgeOrphanUploads(),
    retainedFiles: await purgeRetainedFiles(),
    stagingRows: await purgeStagingRows(),
    expiredSessions: await purgeExpiredSessions(),
    staleMappingCache: await purgeStaleMappingCache(),
    reconciled: await reconcileStuckImports(),
  };
  const total = Object.values(results).reduce((a, b) => a + b, 0);
  if (total > 0) console.log("[worker] cleanup:", results);
}
