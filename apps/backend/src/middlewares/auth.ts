import type { Context } from "hono";

import { createMiddleware } from "hono/factory";
import { z } from "zod";

import type { DepartmentRole } from "@/db/schema/department/index.ts";
import type { AppEnv, AuthSession } from "@/types/index.ts";

import { db } from "@/db";
import { auth } from "@/lib/auth.ts";
import { normalizeIdentifier } from "@/lib/utils.ts";

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

const departmentLocatorSchema = z
  .object({
    departmentId: z.string().trim().min(1).max(64).optional(),
    departmentSlug: z.string().trim().min(1).max(63).optional(),
  })
  .refine((value) => Boolean(value.departmentId || value.departmentSlug), {
    path: ["departmentId"],
    message: "Provide departmentId or departmentSlug.",
  });

const departmentRolePriority: Record<DepartmentRole, number> = {
  department_staff: 0,
  department_admin: 1,
};

async function resolveGlobalRoles(c: Context<AppEnv>): Promise<AppEnv["Variables"]["globalRoles"]> {
  if (c.get("hasResolvedGlobalRoles")) {
    return c.get("globalRoles");
  }

  const user = c.get("user");

  if (!user) {
    c.set("hasResolvedGlobalRoles", true);
    c.set("globalRoles", []);
    return [];
  }

  const globalRoles = await db.query.userGlobalRoles.findMany({
    where: (table, { eq }) => eq(table.userId, user.id),
    columns: {
      role: true,
    },
  });

  const resolvedRoles = globalRoles.map((globalRole) => globalRole.role);

  c.set("hasResolvedGlobalRoles", true);
  c.set("globalRoles", resolvedRoles);

  return resolvedRoles;
}

async function resolveDepartmentAccess(c: Context<AppEnv>) {
  const params = c.req.param();
  const candidateLocator = {
    departmentId:
      params.departmentId ?? c.req.query("departmentId") ?? c.req.header("x-department-id"),
    departmentSlug:
      params.departmentSlug ?? c.req.query("departmentSlug") ?? c.req.header("x-department-slug"),
  };

  const parsedLocator = departmentLocatorSchema.safeParse(candidateLocator);

  if (!parsedLocator.success) {
    return {
      error: c.json(
        {
          error: parsedLocator.error.issues[0]?.message ?? "Invalid department locator.",
        },
        400,
      ),
    };
  }

  const normalizedDepartmentSlug = parsedLocator.data.departmentSlug
    ? normalizeIdentifier(parsedLocator.data.departmentSlug)
    : null;

  if (parsedLocator.data.departmentSlug && !normalizedDepartmentSlug) {
    return {
      error: c.json(
        {
          error: "Invalid departmentSlug. Use letters, numbers, underscores, or spaces.",
        },
        400,
      ),
    };
  }

  const department = await db.query.departments.findFirst({
    where: (table, { eq }) => {
      if (parsedLocator.data.departmentId) {
        return eq(table.id, parsedLocator.data.departmentId);
      }

      return eq(table.slug, normalizedDepartmentSlug ?? "");
    },
  });

  if (!department) {
    return {
      error: c.json(
        {
          error: "Department not found.",
        },
        404,
      ),
    };
  }

  c.set("department", department);

  const user = c.get("user");

  if (!user) {
    return {
      error: c.json(
        {
          error: "You are not signed in.",
        },
        401,
      ),
    };
  }

  const globalRoles = await resolveGlobalRoles(c);

  if (globalRoles.includes("system_admin")) {
    c.set("departmentMembership", null);

    return {
      department,
      membership: null,
      isSystemAdmin: true,
    };
  }

  const membership = await db.query.departmentMemberships.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.departmentId, department.id),
        eq(table.userId, user.id),
        eq(table.isActive, true),
      ),
  });

  c.set("departmentMembership", membership ?? null);

  if (!membership) {
    return {
      error: c.json(
        {
          error: "You do not have access to this department.",
        },
        403,
      ),
    };
  }

  return {
    department,
    membership,
    isSystemAdmin: false,
  };
}

export const authSessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set("hasResolvedAuthSession", false);
  c.set("hasResolvedGlobalRoles", false);
  c.set("user", null);
  c.set("session", null);
  c.set("globalRoles", []);
  c.set("department", null);
  c.set("departmentMembership", null);

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

export const requireSystemAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const session = await resolveAuthSession(c);

  if (!session) {
    return c.json({ error: "You are not signed in." }, 401);
  }

  const globalRoles = await resolveGlobalRoles(c);

  if (!globalRoles.includes("system_admin")) {
    return c.json({ error: "Only system admins can access this route." }, 403);
  }

  await next();
});

function createDepartmentRoleMiddleware(requiredRole: DepartmentRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await resolveAuthSession(c);

    if (!session) {
      return c.json({ error: "You are not signed in." }, 401);
    }

    const access = await resolveDepartmentAccess(c);

    if ("error" in access) {
      return access.error;
    }

    if (access.isSystemAdmin) {
      await next();
      return;
    }

    const membership = access.membership;

    if (!membership) {
      return c.json({ error: "Department membership could not be resolved." }, 403);
    }

    const membershipRole = membership.role;

    if (departmentRolePriority[membershipRole] < departmentRolePriority[requiredRole]) {
      return c.json(
        {
          error: `This route requires ${requiredRole} access.`,
        },
        403,
      );
    }

    await next();
  });
}

export const requireDepartmentStaff = createDepartmentRoleMiddleware("department_staff");
export const requireDepartmentAdmin = createDepartmentRoleMiddleware("department_admin");
