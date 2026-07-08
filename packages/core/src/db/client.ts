import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(databaseUrl: string | undefined = process.env.DATABASE_URL): {
  db: Db;
  pool: pg.Pool;
} {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
