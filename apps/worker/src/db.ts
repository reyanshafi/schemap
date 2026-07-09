import { createDb } from "@schemap/core";

import { env } from "./env";

export const { db, pool } = createDb(env.databaseUrl);
