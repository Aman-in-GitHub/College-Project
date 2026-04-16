import pino from "pino";

import { env } from "@/lib/env";

export const logger = pino({
  base: undefined,
  level: "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
        }
      : undefined,
});
