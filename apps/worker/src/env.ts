import { fileURLToPath } from "node:url";

import { config } from "dotenv";

// root .env regardless of cwd — must be imported before any module that reads process.env
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://schemap:schemap@localhost:5432/schemap",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
};
