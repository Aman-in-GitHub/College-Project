import { z } from "zod";

const rawEnv = Object.fromEntries(
  Object.entries(import.meta.env).map(([k, v]) => [k, v === "" ? undefined : v]),
);

const EnvSchema = z.object({
  VITE_SERVER_URL: z.url(),
});

export const env = EnvSchema.parse(rawEnv);
