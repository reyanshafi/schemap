import { createDb } from "@schemap/core";

import { env } from "./env";

export const { db, pool } = createDb(
  env.databaseUrl ?? "postgres://schemap:schemap@localhost:5432/schemap",
);
