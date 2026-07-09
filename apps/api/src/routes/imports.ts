import {
  DUPLICATE_POLICIES,
  headerSignature,
  LIMITS,
  mappingSchema,
  newId,
  ROW_STATUSES,
  tables,
  VALIDATION_POLICIES,
  validateRow,
} from "@schemap/core";
import { and, asc, count, eq, gt, isNull, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db";
import { AppError } from "../errors";
import { parseBody } from "../lib/http";
import { enqueueParse, enqueueValidate } from "../lib/queues";
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

// human confirms/overrides the proposed mapping (docs/02 §4.5) → validating
const confirmMappingBody = z.object({ mapping: mappingSchema.min(1) });

importsRouter.post("/:id/mapping", async (req, res) => {
  const body = parseBody(confirmMappingBody, req.body);
  const imp = await loadImport(req.auth!.workspaceId, req.params.id);
  if (imp.status !== "awaiting_review") {
    throw new AppError(409, "invalid_state", `Import is "${imp.status}", expected "awaiting_review"`);
  }
  if (!imp.headers?.length) throw new AppError(409, "invalid_state", "Import has no headers");

  const [schema] = await db
    .select()
    .from(tables.schemas)
    .where(eq(tables.schemas.id, imp.schemaId))
    .limit(1);
  if (!schema) throw new AppError(404, "not_found", "Schema not found");

  const fieldKeys = new Set(schema.fields.map((f) => f.key));
  const seenFields = new Set<string>();
  for (const entry of body.mapping) {
    if (entry.sourceIndex >= imp.headers.length) {
      throw new AppError(400, "invalid_mapping", `sourceIndex ${entry.sourceIndex} is out of range`);
    }
    if (entry.field === null) continue;
    if (!fieldKeys.has(entry.field)) {
      throw new AppError(400, "invalid_mapping", `Unknown schema field "${entry.field}"`);
    }
    if (seenFields.has(entry.field)) {
      throw new AppError(400, "invalid_mapping", `Field "${entry.field}" is mapped by two columns`);
    }
    seenFields.add(entry.field);
  }
  for (const field of schema.fields) {
    if (field.required && !seenFields.has(field.key)) {
      throw new AppError(
        400,
        "invalid_mapping",
        `Required field "${field.key}" is not mapped to any column`,
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tables.imports)
      .set({ confirmedMapping: body.mapping, status: "validating", updatedAt: new Date() })
      .where(eq(tables.imports.id, imp.id));
    await tx.insert(tables.importEvents).values({
      importId: imp.id,
      workspaceId: imp.workspaceId,
      fromStatus: "awaiting_review",
      toStatus: "validating",
      actor: actorFor(req.auth!.via),
    });
    // confirmed human choices teach the cache — the system learns per workspace (docs/03 §4.5)
    await tx
      .insert(tables.mappingCache)
      .values({
        id: newId("mappingCache"),
        workspaceId: imp.workspaceId,
        schemaId: schema.id,
        schemaVersion: schema.version,
        headerSignature: headerSignature(imp.headers!),
        mapping: body.mapping,
        source: "human",
      })
      .onConflictDoUpdate({
        target: [
          tables.mappingCache.schemaId,
          tables.mappingCache.schemaVersion,
          tables.mappingCache.headerSignature,
        ],
        set: { mapping: body.mapping, source: "human", updatedAt: new Date() },
      });
  });

  await enqueueValidate(imp.id); // Phase 5 implements the validate processor
  res.json({ import: { id: imp.id, status: "validating" } });
});

async function refreshRowCounts(importId: string): Promise<void> {
  const counts = await db
    .select({ status: tables.importRows.status, n: count() })
    .from(tables.importRows)
    .where(eq(tables.importRows.importId, importId))
    .groupBy(tables.importRows.status);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  await db
    .update(tables.imports)
    .set({
      validCount: byStatus["valid"] ?? 0,
      invalidCount: byStatus["invalid"] ?? 0,
      excludedCount: byStatus["excluded"] ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(tables.imports.id, importId));
}

// inline-fix a row during error review (docs/02 §8) — re-validated immediately
const patchRowBody = z.object({ raw: z.array(z.string().nullable()).min(1) });

importsRouter.patch("/:id/rows/:rowNo", async (req, res) => {
  const body = parseBody(patchRowBody, req.body);
  const imp = await loadImport(req.auth!.workspaceId, req.params.id);
  if (imp.status !== "awaiting_confirm") {
    throw new AppError(409, "invalid_state", `Import is "${imp.status}", expected "awaiting_confirm"`);
  }
  if (!imp.confirmedMapping?.length) throw new AppError(409, "invalid_state", "No confirmed mapping");

  const rowNo = Number(req.params.rowNo);
  const [row] = await db
    .select()
    .from(tables.importRows)
    .where(and(eq(tables.importRows.importId, imp.id), eq(tables.importRows.rowNo, rowNo)))
    .limit(1);
  if (!row) throw new AppError(404, "not_found", "Row not found");

  const [schema] = await db
    .select()
    .from(tables.schemas)
    .where(eq(tables.schemas.id, imp.schemaId))
    .limit(1);
  if (!schema) throw new AppError(404, "not_found", "Schema not found");

  const result = validateRow({
    fields: schema.fields,
    mapping: imp.confirmedMapping,
    raw: body.raw,
    defaultPhoneRegion: schema.defaultPhoneRegion,
  });

  // duplicate check against the rest of the file
  const errors = [...result.errors];
  if (result.dedupHash) {
    const [dup] = await db
      .select({ rowNo: tables.importRows.rowNo })
      .from(tables.importRows)
      .where(
        and(
          eq(tables.importRows.importId, imp.id),
          eq(tables.importRows.dedupHash, result.dedupHash),
          ne(tables.importRows.rowNo, rowNo),
          ne(tables.importRows.status, "excluded"),
        ),
      )
      .limit(1);
    if (dup) {
      errors.push({
        field: null,
        code: "duplicate",
        message: `Duplicate of row ${dup.rowNo} (matching unique fields)`,
      });
    }
  }

  const status = errors.length === 0 ? "valid" : "invalid";
  await db
    .update(tables.importRows)
    .set({
      raw: body.raw,
      data: result.data,
      status,
      errors: errors.length ? errors : null,
      dedupHash: result.dedupHash,
      edited: true,
    })
    .where(and(eq(tables.importRows.importId, imp.id), eq(tables.importRows.rowNo, rowNo)));
  await refreshRowCounts(imp.id);

  res.json({ row: { rowNo, status, errors: errors.length ? errors : null, data: result.data } });
});

// end user confirms the import after fixing/reviewing errors (docs/02 §4.7) → importing
importsRouter.post("/:id/confirm", async (req, res) => {
  const imp = await loadImport(req.auth!.workspaceId, req.params.id);
  if (imp.status !== "awaiting_confirm") {
    throw new AppError(409, "invalid_state", `Import is "${imp.status}", expected "awaiting_confirm"`);
  }
  if (imp.validationPolicy === "require_all_valid" && imp.invalidCount > 0) {
    throw new AppError(
      409,
      "invalid_rows_remaining",
      `${imp.invalidCount} invalid row(s) must be fixed or excluded first (policy: require_all_valid)`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tables.imports)
      .set({ status: "importing", updatedAt: new Date() })
      .where(eq(tables.imports.id, imp.id));
    await tx.insert(tables.importEvents).values({
      importId: imp.id,
      workspaceId: imp.workspaceId,
      fromStatus: "awaiting_confirm",
      toStatus: "importing",
      actor: actorFor(req.auth!.via),
    });
  });
  // Phase 6: pack valid rows into batches of 500 and enqueue webhook delivery
  res.json({ import: { id: imp.id, status: "importing" } });
});

// pull-mode row fetch with keyset cursor (docs/02 §8)
importsRouter.get("/:id/rows", async (req, res) => {
  const imp = await loadImport(req.auth!.workspaceId, req.params.id);
  const status = typeof req.query.status === "string" ? req.query.status : "valid";
  if (!(ROW_STATUSES as readonly string[]).includes(status)) {
    throw new AppError(400, "invalid_request", `Unknown row status "${status}"`);
  }
  const cursor = Number(req.query.cursor ?? 0);
  const limit = Math.min(Number(req.query.limit ?? 100), 1000);

  const rows = await db
    .select({
      rowNo: tables.importRows.rowNo,
      raw: tables.importRows.raw,
      data: tables.importRows.data,
      errors: tables.importRows.errors,
      edited: tables.importRows.edited,
    })
    .from(tables.importRows)
    .where(
      and(
        eq(tables.importRows.importId, imp.id),
        eq(tables.importRows.status, status as (typeof ROW_STATUSES)[number]),
        gt(tables.importRows.rowNo, Number.isFinite(cursor) ? cursor : 0),
      ),
    )
    .orderBy(asc(tables.importRows.rowNo))
    .limit(limit);

  res.json({
    rows,
    nextCursor: rows.length === limit ? rows[rows.length - 1]!.rowNo : null,
  });
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
