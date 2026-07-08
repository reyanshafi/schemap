import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// root .env (cwd is packages/core when run via npm -w)
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // default matches docker-compose.yml so a fresh clone works with zero config
    url: process.env.DATABASE_URL ?? "postgres://schemap:schemap@localhost:5432/schemap",
  },
});
