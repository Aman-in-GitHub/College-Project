import { defineConfig } from "drizzle-kit";

import { env } from "@/lib/env";

export default defineConfig({
  strict: true,
  verbose: true,
  casing: "snake_case",
  dialect: "postgresql",
  out: "./src/db/migrations",
  schema: "./src/db/schema/index.ts",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
