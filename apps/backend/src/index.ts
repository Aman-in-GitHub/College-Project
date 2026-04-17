import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { rateLimiter, RedisStore } from "hono-rate-limiter";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import type { AppEnv } from "@/types/index.ts";

import { db } from "@/db";
import { auth } from "@/lib/auth.ts";
import {
  GLOBAL_RATE_LIMIT_MAX,
  GLOBAL_RATE_LIMIT_WINDOW,
  REDIS_RATE_LIMIT_PREFIX,
} from "@/lib/constants";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { redis, redisRateLimitStoreAdapter } from "@/lib/redis";
import { getClientIp } from "@/lib/utils";
import { authSessionMiddleware } from "@/middlewares/auth.ts";
import { routes } from "@/routes";

const app = new Hono<AppEnv>();

app.use(requestId());
app.use(
  "*",
  cors({
    credentials: true,
    exposeHeaders: ["Content-Length"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization"],
    origin: [env.CLIENT_URL],
  }),
);
app.use(secureHeaders());
app.use(
  "/api/*",
  rateLimiter({
    limit: GLOBAL_RATE_LIMIT_MAX,
    windowMs: GLOBAL_RATE_LIMIT_WINDOW,
    skip: (c) => c.req.method === "OPTIONS" || getClientIp(c) === null,
    keyGenerator: (c) => {
      const clientIp = getClientIp(c);

      if (!clientIp) {
        throw new Error("Missing client IP for rate limiter");
      }

      return clientIp;
    },
    store: new RedisStore({ client: redisRateLimitStoreAdapter, prefix: REDIS_RATE_LIMIT_PREFIX }),
  }),
);
app.use(async (c, next) => {
  const start = Date.now();

  const reqLogger = logger.child({
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
  });

  c.set("logger", reqLogger);

  try {
    await next();
  } finally {
    reqLogger.info({
      status: c.res.status,
      duration: `${Date.now() - start}ms`,
    });
  }
});

app.use("/api/*", authSessionMiddleware);

app.onError((error, c) => {
  const statusCode = error instanceof HTTPException ? error.status : 500;

  const is429 = statusCode === 429;

  if (!is429) {
    logger.error({ err: error, url: c.req.url }, "Unhandled error");
  }

  const response = {
    success: false,
    message: is429 || env.NODE_ENV !== "production" ? error.message : "Internal Server Error",
    data: null,
  };

  return c.json(response, statusCode);
});

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});
app.route("/", routes);

app.get("/", (c) => {
  const response = {
    success: true,
    message: "Hello World!",
    data: {
      timestamp: new Date().toISOString(),
    },
  };
  return c.json(response, 200);
});

app.get("/favicon.ico", (c) => c.body(null, 204));

app.get("/live", (c) => {
  return c.json(
    {
      success: true,
      message: "Server is live",
      data: {
        timestamp: new Date().toISOString(),
      },
    },
    200,
  );
});

app.get("/ready", async (c) => {
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);
  };

  const checks = await Promise.allSettled([
    withTimeout(db.execute(sql`SELECT 1`), 3000),
    withTimeout(redis.ping(), 3000),
  ]);

  const results = {
    db: checks[0].status === "fulfilled" ? "ok" : (checks[0].reason?.message ?? "error"),
    redis: checks[1].status === "fulfilled" ? "ok" : (checks[1].reason?.message ?? "error"),
  };

  const allHealthy = Object.values(results).every((v) => v === "ok");

  return c.json(
    {
      success: allHealthy,
      message: allHealthy ? "All services are healthy" : "Some services are unhealthy",
      data: results,
    },
    allHealthy ? 200 : 503,
  );
});

app.notFound((c) => {
  const response = {
    success: false,
    message: "Not Found",
    data: null,
  };
  return c.json(response, 404);
});

const server = Bun.serve({
  fetch: app.fetch,
  port: env.PORT,
});

logger.info({ port: env.PORT, environment: env.NODE_ENV }, "Server start successful");

let isShuttingDown = false;

async function shutdown(signal: Parameters<typeof process.on>[0], exitCode = 0): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  logger.info({ signal }, "Shutting down...");
  await server.stop();
  redis.close();
  logger.info("Shutdown complete");
  process.exit(exitCode);
}

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
