import { RedisClient } from "bun";

import { env } from "@/lib/env.ts";

export const redis = new RedisClient(env.REDIS_URL);

export const redisRateLimitStoreAdapter = {
  scriptLoad: (script: string) => redis.send("SCRIPT", ["LOAD", script]) as Promise<string>,
  evalsha: <TArgs extends unknown[], TData = unknown>(sha1: string, keys: string[], args: TArgs) =>
    redis.send("EVALSHA", [
      sha1,
      String(keys.length),
      ...keys,
      ...(args as string[]),
    ]) as Promise<TData>,
  decr: (key: string) => redis.decr(key),
  del: (key: string) => redis.del(key),
};
