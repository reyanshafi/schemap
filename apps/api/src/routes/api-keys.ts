import { generateApiKey, KEY_MODES, newId, tables } from "@schemap/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db";
import { AppError } from "../errors";
import { parseBody } from "../lib/http";
import { requireSession } from "../middleware/auth";

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  mode: z.enum(KEY_MODES),
});

export const apiKeysRouter = Router();
apiKeysRouter.use(requireSession);

const publicColumns = {
  id: tables.apiKeys.id,
  name: tables.apiKeys.name,
  mode: tables.apiKeys.mode,
  last4: tables.apiKeys.last4,
  lastUsedAt: tables.apiKeys.lastUsedAt,
  createdAt: tables.apiKeys.createdAt,
  revokedAt: tables.apiKeys.revokedAt,
};

apiKeysRouter.get("/", async (req, res) => {
  const keys = await db
    .select(publicColumns)
    .from(tables.apiKeys)
    .where(eq(tables.apiKeys.workspaceId, req.auth!.workspaceId))
    .orderBy(desc(tables.apiKeys.createdAt));
  res.json({ apiKeys: keys });
});

apiKeysRouter.post("/", async (req, res) => {
  const body = parseBody(createKeySchema, req.body);
  const { raw, hash, last4 } = generateApiKey(body.mode);
  const id = newId("apiKey");

  await db.insert(tables.apiKeys).values({
    id,
    workspaceId: req.auth!.workspaceId,
    name: body.name,
    mode: body.mode,
    keyHash: hash,
    last4,
  });

  // raw key is returned exactly once and never stored (docs/03 §3.3)
  res.status(201).json({
    apiKey: { id, name: body.name, mode: body.mode, last4 },
    rawKey: raw,
  });
});

apiKeysRouter.post("/:id/revoke", async (req, res) => {
  const [updated] = await db
    .update(tables.apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(tables.apiKeys.id, req.params.id),
        eq(tables.apiKeys.workspaceId, req.auth!.workspaceId),
        isNull(tables.apiKeys.revokedAt),
      ),
    )
    .returning({ id: tables.apiKeys.id });

  if (!updated) throw new AppError(404, "not_found", "API key not found or already revoked");
  res.json({ ok: true });
});
