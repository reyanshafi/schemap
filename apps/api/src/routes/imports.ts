import {
  DUPLICATE_POLICIES,
  LIMITS,
  newId,
  tables,
  VALIDATION_POLICIES,
} from "@schemap/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db";
import { AppError } from "../errors";
import { parseBody } from "../lib/http";
import { enqueueParse } from "../lib/queues";
import { requireImportAuth } from "../middleware/auth";

const createImportBody = z.object({
  uploadId: z.string().min(1),
  schemaId: z.string().optional(),
  schemaKey: z.string().optional(),
  endUserOrg: z.string().max(120).optional(),
  // per-embed policy overrides (PRD §6.2)
  validationPolicy: z.enum(VALIDATION_POLICIES).optional(),
  duplicatePolicy: z.enum(DUPLICATE_POLICIES).optional(),
});

export const importsRouter = Router();
importsRouter.use(requireImportAuth);

const actorFor = (via: string) =>
  via === "embed" ? "end_user" : via === "api_key" ? "developer_api" : "dashboard";

importsRouter.post("/", async (req, res) => {
  const body = parseBody(createImportBody, req.body);
  const auth = req.auth!;

  // embed tokens are pinned to one schema; other callers name it
  const schemaId = auth.via === "embed" ? auth.embedSchemaId : body.schemaId;
  if (!schemaId && !body.schemaKey) {
    throw new AppError(400, "invalid_request", "schemaId or schemaKey is required");
  }

  const [schema] = await db
    .select()
    .from(tables.schemas)
    .where(
      and(
        eq(tables.schemas.workspaceId, auth.workspaceId),
        isNull(tables.schemas.archivedAt),
        schemaId ? eq(tables.schemas.id, schemaId) : eq(tables.schemas.key, body.schemaKey!),
      ),
    )
    .limit(1);
  if (!schema) throw new AppError(404, "not_found", "Schema not found");

  const [upload] = await db
    .select()
    .from(tables.uploads)
    .where(
      and(eq(tables.uploads.id, body.uploadId), eq(tables.uploads.workspaceId, auth.workspaceId)),
    )
    .limit(1);
  if (!upload) throw new AppError(404, "not_found", "Upload not found");
  if (upload.consumedByImportId) {
    throw new AppError(409, "upload_already_used", "This upload already belongs to an import");
  }

  const id = newId("import");
  await db.transaction(async (tx) => {
    await tx.insert(tables.imports).values({
      id,
      workspaceId: auth.workspaceId,
      schemaId: schema.id,
      uploadId: upload.id,
      schemaVersion: schema.version, // pinned — later schema edits don't affect this import
      endUserOrg: body.endUserOrg ?? auth.endUserOrg,
      validationPolicy: body.validationPolicy ?? schema.validationPolicy,
      duplicatePolicy: body.duplicatePolicy ?? schema.duplicatePolicy,
    });
    await tx
      .update(tables.uploads)
      .set({ consumedByImportId: id })
      .where(eq(tables.uploads.id, upload.id));
    await tx.insert(tables.importEvents).values({
      importId: id,
      workspaceId: auth.workspaceId,
      fromStatus: null,
      toStatus: "created",
      actor: actorFor(auth.via),
    });
  });

  await enqueueParse(id);
  res.status(201).json({ import: { id, status: "created", schemaId: schema.id } });
});

const importColumns = {
  id: tables.imports.id,
  schemaId: tables.imports.schemaId,
  schemaVersion: tables.imports.schemaVersion,
  status: tables.imports.status,
  failureReason: tables.imports.failureReason,
  rowCount: tables.imports.rowCount,
  validCount: tables.imports.validCount,
  invalidCount: tables.imports.invalidCount,
  excludedCount: tables.imports.excludedCount,
  deliveredCount: tables.imports.deliveredCount,
  errorSummary: tables.imports.errorSummary,
  createdAt: tables.imports.createdAt,
  updatedAt: tables.imports.updatedAt,
  completedAt: tables.imports.completedAt,
};

async function loadImport(workspaceId: string, id: string) {
  const [imp] = await db
    .select()
    .from(tables.imports)
    .where(and(eq(tables.imports.id, id), eq(tables.imports.workspaceId, workspaceId)))
    .limit(1);
  if (!imp) throw new AppError(404, "not_found", "Import not found");
  return imp;
}

importsRouter.get("/:id", async (req, res) => {
  const imp = await loadImport(req.auth!.workspaceId, req.params.id);
  const publicView = Object.fromEntries(
    Object.keys(importColumns).map((k) => [k, imp[k as keyof typeof imp]]),
  );
  res.json({ import: publicView });
});

// headers + samples + suggested mapping + first 100 raw rows (docs/02 §8)
importsRouter.get("/:id/preview", async (req, res) => {
  const imp = await loadImport(req.auth!.workspaceId, req.params.id);

  const rows = await db
    .select({ rowNo: tables.importRows.rowNo, raw: tables.importRows.raw })
    .from(tables.importRows)
    .where(eq(tables.importRows.importId, imp.id))
    .orderBy(asc(tables.importRows.rowNo))
    .limit(LIMITS.previewRows);

  res.json({
    importId: imp.id,
    status: imp.status,
    delimiter: imp.delimiter,
    headers: imp.headers,
    columnSamples: imp.columnSamples,
    proposedMapping: imp.proposedMapping,
    mappingSource: imp.mappingSource,
    rowCount: imp.rowCount,
    rows,
  });
});
