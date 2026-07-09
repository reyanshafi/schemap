import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";

import { env } from "./env";
import { errorHandler, notFoundHandler } from "./errors";
import { apiKeysRouter } from "./routes/api-keys";
import { authRouter } from "./routes/auth";
import { embedTokensRouter } from "./routes/embed-tokens";
import { importsRouter } from "./routes/imports";
import { schemasRouter } from "./routes/schemas";
import { uploadsRouter } from "./routes/uploads";
import { webhookDeliveriesRouter } from "./routes/webhook-deliveries";
import { webhookEndpointsRouter } from "./routes/webhook-endpoints";

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
  app.use("/v1/embed-tokens", embedTokensRouter);
  app.use("/v1/uploads", uploadsRouter);
  app.use("/v1/imports", importsRouter);
  app.use("/v1/webhook-endpoints", webhookEndpointsRouter);
  app.use("/v1/webhook-deliveries", webhookDeliveriesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
