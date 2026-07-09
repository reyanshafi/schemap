import { LIMITS, newId, tables } from "@schemap/core";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db";
import { AppError } from "../errors";
import { parseBody } from "../lib/http";
import { requireImportAuth } from "../middleware/auth";
import { storage } from "../storage";

const createUploadBody = z.object({
  filename: z.string().min(1).max(255),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(LIMITS.maxFileBytes, `Files are limited to ${LIMITS.maxFileBytes / 1024 / 1024} MB`),
  mime: z.string().max(127).optional(),
});

const PRESIGN_TTL_SECONDS = 600;

export const uploadsRouter = Router();
uploadsRouter.use(requireImportAuth);

uploadsRouter.post("/", async (req, res) => {
  const body = parseBody(createUploadBody, req.body);

  const [workspace] = await db
    .select({ retentionDays: tables.workspaces.retentionDays })
    .from(tables.workspaces)
    .where(eq(tables.workspaces.id, req.auth!.workspaceId))
    .limit(1);
  if (!workspace) throw new AppError(404, "not_found", "Workspace not found");

  const id = newId("upload");
  const storageKey = `uploads/${req.auth!.workspaceId}/${id}`;
  await db.insert(tables.uploads).values({
    id,
    workspaceId: req.auth!.workspaceId,
    storageKey,
    filename: body.filename,
    byteSize: body.byteSize,
    declaredMime: body.mime,
    deleteAfter: new Date(Date.now() + workspace.retentionDays * 24 * 60 * 60 * 1000),
  });

  // browser PUTs the file straight to storage — it never flows through this API (docs/02 §4.2)
  const uploadUrl = await storage.presignUpload(storageKey, PRESIGN_TTL_SECONDS);
  res.status(201).json({
    upload: { id, filename: body.filename },
    uploadUrl,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
  });
});
