import { drizzle } from "drizzle-orm/bun-sql";
import postgres from "postgres";

import * as schema from "@/db/schema/index.ts";
import { env } from "@/lib/env.ts";

export const postgresClient = postgres(env.DATABASE_URL);

export const db = drizzle({
  schema: schema,
  casing: "snake_case",
  logger: env.NODE_ENV === "development",
  connection: {
    url: env.DATABASE_URL,
  },
});
