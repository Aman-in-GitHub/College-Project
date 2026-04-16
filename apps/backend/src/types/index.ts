import { auth } from "@/lib/auth.ts";
import { logger } from "@/lib/logger.ts";

export type AuthSession = typeof auth.$Infer.Session;
export type AuthenticatedSession = AuthSession["session"];
export type AuthenticatedUser = AuthSession["user"];

export type AppVariables = {
  hasResolvedAuthSession: boolean;
  user: AuthenticatedUser | null;
  session: AuthenticatedSession | null;
  logger: typeof logger;
};

export type AppEnv = {
  Variables: AppVariables;
};
