import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { username } from "better-auth/plugins/username";

import { db } from "@/db";
import { env } from "@/lib/env";

export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    username(),
    admin({
      bannedUserMessage: "Your account has been banned. Please contact the administrator.",
    }),
  ],
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
  }),
  trustedOrigins: [env.CLIENT_URL],
  advanced: {
    defaultCookieAttributes: {
      secure: true,
      sameSite: "none",
      partitioned: true,
    },
  },
});
