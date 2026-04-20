import { z } from "zod";

const rawEnv = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(["development", "production"]),
  DATABASE_URL: z.url(),
  CLIENT_URL: z.url(),
  FASTAPI_URL: z.url(),
  FASTAPI_INTERNAL_TOKEN: z.string().min(1),
  REDIS_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
});

export const env = EnvSchema.parse(rawEnv);
