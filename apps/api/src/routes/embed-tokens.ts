import { tables } from "@schemap/core";
import { and, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db";
import { AppError } from "../errors";
import { EMBED_TOKEN_TTL_SECONDS, mintEmbedToken } from "../lib/embed-tokens";
import { parseBody } from "../lib/http";
import { requireApiKey } from "../middleware/auth";

const mintBody = z
  .object({
    schemaId: z.string().optional(),
    schemaKey: z.string().optional(),
    endUserOrg: z.string().max(120).optional(),
  })
  .refine((b) => b.schemaId || b.schemaKey, { message: "schemaId or schemaKey is required" });

export const embedTokensRouter = Router();
embedTokensRouter.use(requireApiKey); // host backend only — the browser never sees an API key

embedTokensRouter.post("/", async (req, res) => {
  const body = parseBody(mintBody, req.body);

  const [schema] = await db
    .select({ id: tables.schemas.id })
    .from(tables.schemas)
    .where(
      and(
        eq(tables.schemas.workspaceId, req.auth!.workspaceId),
        isNull(tables.schemas.archivedAt),
        body.schemaId
          ? eq(tables.schemas.id, body.schemaId)
          : eq(tables.schemas.key, body.schemaKey!),
      ),
    )
    .limit(1);
  if (!schema) throw new AppError(404, "not_found", "Schema not found");

  const token = await mintEmbedToken({
    ws: req.auth!.workspaceId,
    sch: schema.id,
    org: body.endUserOrg,
  });
  res.status(201).json({ token, expiresInSeconds: EMBED_TOKEN_TTL_SECONDS });
});
