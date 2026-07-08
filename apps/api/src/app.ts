import express, { type Express, Router } from "express";

import { errorHandler, notFoundHandler } from "./errors";

const startedAt = Date.now();

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  // uploads never pass through the API (presigned direct-to-storage), so 1mb is plenty
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  // Phase 2+: embed-tokens, uploads, imports, schemas, webhook-deliveries
  const v1 = Router();
  app.use("/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
