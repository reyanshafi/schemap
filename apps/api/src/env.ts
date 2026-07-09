import { fileURLToPath } from "node:url";

import { config } from "dotenv";

// root .env regardless of cwd
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

export const env = {
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000",
};
