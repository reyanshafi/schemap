import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";

import { env } from "./env";
import { errorHandler, notFoundHandler } from "./errors";
import { apiKeysRouter } from "./routes/api-keys";
import { authRouter } from "./routes/auth";
import { schemasRouter } from "./routes/schemas";

const startedAt = Date.now();

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: env.dashboardOrigin, credentials: true }));
  app.use(cookieParser());
  // uploads never pass through the API (presigned direct-to-storage), so 1mb is plenty
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  // dashboard-only (session cookie)
  app.use("/auth", authRouter);
  app.use("/dashboard/api-keys", apiKeysRouter);

  // public API (API key; schemas also accept a dashboard session — docs/02 §8)
  app.use("/v1/schemas", schemasRouter);
  // Phase 3+: embed-tokens, uploads, imports, webhook-deliveries

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
