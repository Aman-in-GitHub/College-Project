import type { Context } from "hono";

import { createMiddleware } from "hono/factory";

import type { AppEnv, AuthSession } from "@/types/index.ts";

import { auth } from "@/lib/auth.ts";

async function resolveAuthSession(c: Context<AppEnv>): Promise<AuthSession | null> {
  if (c.get("hasResolvedAuthSession")) {
    const user = c.get("user");
    const session = c.get("session");
    return user && session ? { user, session } : null;
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  c.set("hasResolvedAuthSession", true);
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);

  return session ?? null;
}

export const authSessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set("hasResolvedAuthSession", false);
  c.set("user", null);
  c.set("session", null);

  await resolveAuthSession(c);
  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const session = await resolveAuthSession(c);

  if (!session) {
    return c.json({ error: "You are not signed in." }, 401);
  }

  await next();
});
