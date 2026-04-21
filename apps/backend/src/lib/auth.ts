import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { username } from "better-auth/plugins/username";

import { db } from "@/db";
import { createAuditLog, getAuditRequestContextFromHeaders } from "@/lib/audit-log.ts";
import { env } from "@/lib/env";

export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-out") {
        return;
      }

      const sessionToken = await ctx.getSignedCookie(
        ctx.context.authCookies.sessionToken.name,
        ctx.context.secret,
      );

      if (!sessionToken) {
        return;
      }

      const session = await ctx.context.internalAdapter.findSession(sessionToken);

      if (!session) {
        return;
      }

      try {
        await createAuditLog({
          action: "user.logged_out",
          actorUserId: session.user.id,
          category: "auth_security",
          targetType: "session",
          targetId: session.session.id,
          targetUserId: session.user.id,
          summary: `Logged out ${session.user.email}.`,
          metadata: {
            sessionId: session.session.id,
          },
          ...getAuditRequestContextFromHeaders(ctx.headers),
        });
      } catch (error) {
        ctx.context.logger.error("Failed to create logout audit log", error);
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") {
        return;
      }

      const newSession = ctx.context.newSession;

      if (!newSession) {
        return;
      }

      try {
        await createAuditLog({
          action: "user.logged_in",
          actorUserId: newSession.user.id,
          category: "auth_security",
          targetType: "session",
          targetId: newSession.session.id,
          targetUserId: newSession.user.id,
          summary: `Logged in ${newSession.user.email}.`,
          metadata: {
            method: "email_password",
            sessionId: newSession.session.id,
          },
          ...getAuditRequestContextFromHeaders(ctx.headers),
        });
      } catch (error) {
        ctx.context.logger.error("Failed to create login audit log", error);
      }
    }),
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
