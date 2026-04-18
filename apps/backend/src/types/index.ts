import type {
  Department,
  DepartmentMembership,
  DepartmentRole,
  GlobalRole,
} from "@/db/schema/department/index.ts";

import { auth } from "@/lib/auth.ts";
import { logger } from "@/lib/logger.ts";

export type AuthSession = typeof auth.$Infer.Session;
export type AuthenticatedSession = AuthSession["session"];
export type AuthenticatedUser = AuthSession["user"];

export type AppVariables = {
  hasResolvedAuthSession: boolean;
  hasResolvedGlobalRoles: boolean;
  user: AuthenticatedUser | null;
  session: AuthenticatedSession | null;
  globalRoles: GlobalRole[];
  department: Department | null;
  departmentMembership: DepartmentMembership | null;
  logger: typeof logger;
};

export type AppEnv = {
  Variables: AppVariables;
};

export type { DepartmentRole, GlobalRole };
