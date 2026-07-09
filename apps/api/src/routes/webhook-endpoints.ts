import { encryptSecret, KEY_MODES, newId, newWebhookSecret, tables } from "@schemap/core";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db";
import { AppError } from "../errors";
import { parseBody } from "../lib/http";
import { requireWorkspaceAuth } from "../middleware/auth";

const createEndpointBody = z.object({
  url: z.string().url().max(2000),
  mode: z.enum(KEY_MODES),
});

function assertUrlAllowed(rawUrl: string, mode: "test" | "live"): void {
  const url = new URL(rawUrl);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (mode === "live" && url.protocol !== "https:") {
    throw new AppError(400, "invalid_url", "Live-mode webhook URLs must use HTTPS");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new AppError(400, "invalid_url", "Webhook URLs must be HTTPS (or http://localhost in test mode)");
  }
}

export const webhookEndpointsRouter = Router();
webhookEndpointsRouter.use(requireWorkspaceAuth);

const publicColumns = {
  id: tables.webhookEndpoints.id,
  url: tables.webhookEndpoints.url,
  mode: tables.webhookEndpoints.mode,
  active: tables.webhookEndpoints.active,
  createdAt: tables.webhookEndpoints.createdAt,
};

webhookEndpointsRouter.get("/", async (req, res) => {
  const endpoints = await db
    .select(publicColumns)
    .from(tables.webhookEndpoints)
    .where(eq(tables.webhookEndpoints.workspaceId, req.auth!.workspaceId))
    .orderBy(desc(tables.webhookEndpoints.createdAt));
  res.json({ webhookEndpoints: endpoints });
});

webhookEndpointsRouter.post("/", async (req, res) => {
  const body = parseBody(createEndpointBody, req.body);
  assertUrlAllowed(body.url, body.mode);

  const id = newId("webhookEndpoint");
  const secret = newWebhookSecret();
  await db.insert(tables.webhookEndpoints).values({
    id,
    workspaceId: req.auth!.workspaceId,
    url: body.url,
    mode: body.mode,
    secretCiphertext: encryptSecret(Buffer.from(secret, "utf8")),
  });

  // secret is returned exactly once — hosts verify signatures with it
  res.status(201).json({
    webhookEndpoint: { id, url: body.url, mode: body.mode, active: true },
    secret,
  });
});

webhookEndpointsRouter.delete("/:id", async (req, res) => {
  const [updated] = await db
    .update(tables.webhookEndpoints)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(tables.webhookEndpoints.id, req.params.id),
        eq(tables.webhookEndpoints.workspaceId, req.auth!.workspaceId),
        eq(tables.webhookEndpoints.active, true),
      ),
    )
    .returning({ id: tables.webhookEndpoints.id });
  if (!updated) throw new AppError(404, "not_found", "Webhook endpoint not found or already disabled");
  res.json({ ok: true });
});
