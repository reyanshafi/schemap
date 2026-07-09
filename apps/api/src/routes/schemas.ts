import {
  DUPLICATE_POLICIES,
  newId,
  schemaFieldsSchema,
  tables,
  VALIDATION_POLICIES,
} from "@schemap/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db";
import { AppError } from "../errors";
import { isUniqueViolation, parseBody } from "../lib/http";
import { requireWorkspaceAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

const createSchemaBody = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "lowercase letters, digits, _ and - only")
    .max(64),
  name: z.string().min(1).max(120),
  fields: schemaFieldsSchema,
  validationPolicy: z.enum(VALIDATION_POLICIES).optional(),
  duplicatePolicy: z.enum(DUPLICATE_POLICIES).optional(),
  defaultPhoneRegion: z.string().length(2).optional(),
  aiSamplesEnabled: z.boolean().optional(),
});

const updateSchemaBody = createSchemaBody.omit({ key: true }).partial();

export const schemasRouter = Router();
schemasRouter.use(requireWorkspaceAuth);
schemasRouter.use(rateLimit);

function whereActive(workspaceId: string, id?: string) {
  const conditions = [
    eq(tables.schemas.workspaceId, workspaceId),
    isNull(tables.schemas.archivedAt),
  ];
  if (id) conditions.push(eq(tables.schemas.id, id));
  return and(...conditions);
}

schemasRouter.get("/", async (req, res) => {
  const schemas = await db
    .select()
    .from(tables.schemas)
    .where(whereActive(req.auth!.workspaceId))
    .orderBy(desc(tables.schemas.createdAt));
  res.json({ schemas });
});

schemasRouter.post("/", async (req, res) => {
  const body = parseBody(createSchemaBody, req.body);
  const id = newId("schema");
  try {
    const [created] = await db
      .insert(tables.schemas)
      .values({
        id,
        workspaceId: req.auth!.workspaceId,
        key: body.key,
        name: body.name,
        fields: body.fields,
        validationPolicy: body.validationPolicy,
        duplicatePolicy: body.duplicatePolicy,
        defaultPhoneRegion: body.defaultPhoneRegion,
        aiSamplesEnabled: body.aiSamplesEnabled,
      })
      .returning();
    res.status(201).json({ schema: created });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "schema_key_taken", `A schema with key "${body.key}" already exists`);
    }
    throw err;
  }
});

schemasRouter.get("/:id", async (req, res) => {
  const [schema] = await db
    .select()
    .from(tables.schemas)
    .where(whereActive(req.auth!.workspaceId, req.params.id))
    .limit(1);
  if (!schema) throw new AppError(404, "not_found", "Schema not found");
  res.json({ schema });
});

schemasRouter.patch("/:id", async (req, res) => {
  const body = parseBody(updateSchemaBody, req.body);

  const [current] = await db
    .select()
    .from(tables.schemas)
    .where(whereActive(req.auth!.workspaceId, req.params.id))
    .limit(1);
  if (!current) throw new AppError(404, "not_found", "Schema not found");

  // any change to fields or policies bumps the version → invalidates mapping_cache (docs/03 §3.4)
  const versionSensitive = [
    "fields",
    "validationPolicy",
    "duplicatePolicy",
    "defaultPhoneRegion",
    "aiSamplesEnabled",
  ] as const;
  const bump = versionSensitive.some(
    (k) => body[k] !== undefined && JSON.stringify(body[k]) !== JSON.stringify(current[k]),
  );

  const [updated] = await db
    .update(tables.schemas)
    .set({
      name: body.name,
      fields: body.fields,
      validationPolicy: body.validationPolicy,
      duplicatePolicy: body.duplicatePolicy,
      defaultPhoneRegion: body.defaultPhoneRegion,
      aiSamplesEnabled: body.aiSamplesEnabled,
      version: bump ? current.version + 1 : current.version,
      updatedAt: new Date(),
    })
    .where(eq(tables.schemas.id, current.id))
    .returning();

  res.json({ schema: updated });
});

schemasRouter.delete("/:id", async (req, res) => {
  const [archived] = await db
    .update(tables.schemas)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(whereActive(req.auth!.workspaceId, req.params.id))
    .returning({ id: tables.schemas.id });
  if (!archived) throw new AppError(404, "not_found", "Schema not found");
  res.json({ ok: true });
});
