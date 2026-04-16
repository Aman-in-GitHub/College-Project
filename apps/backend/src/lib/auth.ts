import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins/username";

import { db } from "@/db";
import { env } from "@/lib/env";

export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
  },
  plugins: [username()],
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
  }),
  trustedOrigins: [env.CLIENT_URL],
});
