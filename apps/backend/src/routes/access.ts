import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "@/types/index.ts";

import { db } from "@/db";
import { sessions, users } from "@/db/schema/auth.ts";
import { departmentMemberships, departments } from "@/db/schema/department/index.ts";
import { createAuditLog, getAuditRequestContext } from "@/lib/audit-log.ts";
import { auth } from "@/lib/auth.ts";
import { normalizeIdentifier } from "@/lib/utils.ts";
import { requireAuth, requireSystemAdmin } from "@/middlewares/auth.ts";

const CREATE_DEPARTMENT_ADMIN_SCHEMA = z.object({
  departmentName: z.string().trim().min(1).max(120),
  departmentSlug: z.string().trim().min(1).max(63),
  email: z.email({ message: "Please enter a valid email address" }),
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128),
});

const CREATE_STAFF_SCHEMA = z.object({
  email: z.email({ message: "Please enter a valid email address" }),
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128),
});

const BAN_USER_SCHEMA = z.object({
  userId: z.string().trim().min(1),
});

type AccessContext =
  | {
      role: "system_admin";
      department: null;
    }
  | {
      role: "department_admin" | "department_staff";
      department: {
        id: string;
        name: string;
        slug: string;
      };
    }
  | {
      role: "unassigned";
      department: null;
    };

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Something went wrong.";
}

async function logAccessDenied(params: {
  action: string;
  actorUserId: string | null;
  departmentId?: string | null;
  targetUserId?: string | null;
  targetDepartmentId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  requestId?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await createAuditLog({
    action: params.action,
    actorUserId: params.actorUserId,
    category: "access_control",
    status: "denied",
    departmentId: params.departmentId ?? null,
    targetType: params.targetUserId ? "user" : params.targetDepartmentId ? "department" : null,
    targetId: params.targetUserId ?? params.targetDepartmentId ?? null,
    targetUserId: params.targetUserId ?? null,
    targetDepartmentId: params.targetDepartmentId ?? null,
    summary: params.summary,
    metadata: params.metadata ?? null,
    ipAddress: params.ipAddress ?? null,
    requestId: params.requestId ?? null,
    userAgent: params.userAgent ?? null,
  });
}

async function resolveAccessContext(userId: string): Promise<AccessContext> {
  const globalRole = await db.query.userGlobalRoles.findFirst({
    where: (table, { and, eq }) => and(eq(table.userId, userId), eq(table.role, "system_admin")),
    columns: {
      id: true,
    },
  });

  if (globalRole) {
    return {
      role: "system_admin",
      department: null,
    };
  }

  const membership = await db.query.departmentMemberships.findFirst({
    where: (table, { and, eq }) => and(eq(table.userId, userId), eq(table.isActive, true)),
    with: {
      department: {
        columns: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!membership) {
    return {
      role: "unassigned",
      department: null,
    };
  }

  return {
    role: membership.role,
    department: membership.department,
  };
}

export const accessRoutes = new Hono<AppEnv>();

accessRoutes.get("/api/access/context", requireAuth, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json(
      {
        success: false,
        message: "You are not signed in.",
        data: null,
      },
      401,
    );
  }

  const accessContext = await resolveAccessContext(user.id);

  return c.json(
    {
      success: true,
      message: "Access context loaded successfully.",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          username: user.username ?? null,
        },
        role: accessContext.role,
        department: accessContext.department,
      },
    },
    200,
  );
});

accessRoutes.get("/api/access/managed-users", requireAuth, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json(
      {
        success: false,
        message: "You are not signed in.",
        data: null,
      },
      401,
    );
  }

  const accessContext = await resolveAccessContext(user.id);

  if (accessContext.role === "system_admin") {
    const memberships = await db.query.departmentMemberships.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.createdByUserId, user.id),
          eq(table.role, "department_admin"),
          eq(table.isActive, true),
        ),
      with: {
        department: {
          columns: {
            id: true,
            name: true,
            slug: true,
          },
        },
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            username: true,
            banned: true,
          },
        },
      },
    });

    return c.json(
      {
        success: true,
        message: "Department admins loaded successfully.",
        data: {
          role: accessContext.role,
          items: memberships.map((membership) => ({
            id: membership.id,
            role: membership.role,
            createdAt: membership.createdAt.toISOString(),
            department: membership.department,
            user: {
              id: membership.user.id,
              name: membership.user.name,
              email: membership.user.email,
              username: membership.user.username,
              isBanned: membership.user.banned,
            },
          })),
        },
      },
      200,
    );
  }

  if (accessContext.role === "department_admin") {
    const memberships = await db.query.departmentMemberships.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.createdByUserId, user.id),
          eq(table.departmentId, accessContext.department.id),
          eq(table.role, "department_staff"),
          eq(table.isActive, true),
        ),
      with: {
        department: {
          columns: {
            id: true,
            name: true,
            slug: true,
          },
        },
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            username: true,
            banned: true,
          },
        },
      },
    });

    return c.json(
      {
        success: true,
        message: "Department staff loaded successfully.",
        data: {
          role: accessContext.role,
          items: memberships.map((membership) => ({
            id: membership.id,
            role: membership.role,
            createdAt: membership.createdAt.toISOString(),
            department: membership.department,
            user: {
              id: membership.user.id,
              name: membership.user.name,
              email: membership.user.email,
              username: membership.user.username,
              isBanned: membership.user.banned,
            },
          })),
        },
      },
      200,
    );
  }

  return c.json(
    {
      success: true,
      message: "No managed users available for this account.",
      data: {
        role: accessContext.role,
        items: [],
      },
    },
    200,
  );
});

accessRoutes.post("/api/access/department-admins", requireSystemAdmin, async (c) => {
  const currentUser = c.get("user");
  const auditRequestContext = getAuditRequestContext(c);
  const payload = await c.req.json().catch(() => null);
  const parsed = CREATE_DEPARTMENT_ADMIN_SCHEMA.safeParse(payload);

  if (!currentUser) {
    return c.json(
      {
        success: false,
        message: "You are not signed in.",
        data: null,
      },
      401,
    );
  }

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        message: "Invalid department admin payload",
        data: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  const normalizedDepartmentSlug = normalizeIdentifier(parsed.data.departmentSlug);

  if (!normalizedDepartmentSlug) {
    return c.json(
      {
        success: false,
        message: "Invalid department slug.",
        data: null,
      },
      400,
    );
  }

  const existingDepartment = await db.query.departments.findFirst({
    where: (table, { eq }) => eq(table.slug, normalizedDepartmentSlug),
    columns: {
      id: true,
    },
  });

  if (existingDepartment) {
    return c.json(
      {
        success: false,
        message: "A department with this slug already exists.",
        data: null,
      },
      409,
    );
  }

  try {
    const normalizedUsername = parsed.data.username.trim();

    const authResponse = await auth.api.signUpEmail({
      body: {
        email: parsed.data.email.trim(),
        password: parsed.data.password,
        name: normalizedUsername,
        username: normalizedUsername,
        displayUsername: normalizedUsername,
      },
    });

    const insertedDepartments = await db
      .insert(departments)
      .values({
        name: parsed.data.departmentName.trim(),
        slug: normalizedDepartmentSlug,
        createdByUserId: currentUser.id,
        updatedByUserId: currentUser.id,
      })
      .returning({
        id: departments.id,
        name: departments.name,
        slug: departments.slug,
      });

    const department = insertedDepartments[0];

    if (!department) {
      return c.json(
        {
          success: false,
          message: "Department creation failed.",
          data: null,
        },
        500,
      );
    }

    await db.insert(departmentMemberships).values({
      departmentId: department.id,
      userId: authResponse.user.id,
      role: "department_admin",
      createdByUserId: currentUser.id,
    });

    await createAuditLog({
      action: "department.created",
      actorUserId: currentUser.id,
      category: "user_management",
      departmentId: department.id,
      targetType: "department",
      targetId: department.id,
      targetDepartmentId: department.id,
      summary: `Created department ${department.name}.`,
      metadata: {
        slug: department.slug,
      },
      ...auditRequestContext,
    });

    await createAuditLog({
      action: "user.created",
      actorUserId: currentUser.id,
      category: "user_management",
      departmentId: department.id,
      targetType: "user",
      targetId: authResponse.user.id,
      targetUserId: authResponse.user.id,
      targetDepartmentId: department.id,
      summary: `Created department admin ${authResponse.user.email}.`,
      metadata: {
        email: authResponse.user.email,
        username: authResponse.user.username ?? null,
        role: "department_admin",
      },
      ...auditRequestContext,
    });

    await createAuditLog({
      action: "membership.created",
      actorUserId: currentUser.id,
      category: "access_control",
      departmentId: department.id,
      targetType: "membership",
      targetId: `${department.id}:${authResponse.user.id}:department_admin`,
      targetUserId: authResponse.user.id,
      targetDepartmentId: department.id,
      summary: `Assigned department_admin membership in ${department.name} to ${authResponse.user.email}.`,
      metadata: {
        role: "department_admin",
      },
      ...auditRequestContext,
    });

    return c.json(
      {
        success: true,
        message: "Department admin created successfully.",
        data: {
          department,
          user: {
            id: authResponse.user.id,
            name: authResponse.user.name,
            email: authResponse.user.email,
            username: authResponse.user.username ?? null,
          },
        },
      },
      201,
    );
  } catch (error) {
    return c.json(
      {
        success: false,
        message: getErrorMessage(error),
        data: null,
      },
      400,
    );
  }
});

accessRoutes.post("/api/access/ban", requireAuth, async (c) => {
  const currentUser = c.get("user");
  const auditRequestContext = getAuditRequestContext(c);
  const payload = await c.req.json().catch(() => null);
  const parsed = BAN_USER_SCHEMA.safeParse(payload);

  if (!currentUser) {
    return c.json(
      {
        success: false,
        message: "You are not signed in.",
        data: null,
      },
      401,
    );
  }

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        message: "Invalid ban payload",
        data: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  if (parsed.data.userId === currentUser.id) {
    await logAccessDenied({
      action: "user.ban",
      actorUserId: currentUser.id,
      targetUserId: currentUser.id,
      summary: "User attempted to ban their own account.",
      ...auditRequestContext,
    });

    return c.json(
      {
        success: false,
        message: "You cannot ban yourself.",
        data: null,
      },
      400,
    );
  }

  const accessContext = await resolveAccessContext(currentUser.id);
  const targetUser = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, parsed.data.userId),
    columns: {
      id: true,
      email: true,
      banned: true,
      banReason: true,
      banExpires: true,
    },
  });

  if (!targetUser) {
    return c.json(
      {
        success: false,
        message: "User not found.",
        data: null,
      },
      404,
    );
  }

  if (accessContext.role === "system_admin") {
    const membership = await db.query.departmentMemberships.findFirst({
      where: and(
        eq(departmentMemberships.userId, parsed.data.userId),
        eq(departmentMemberships.role, "department_admin"),
        eq(departmentMemberships.createdByUserId, currentUser.id),
      ),
      columns: {
        id: true,
      },
    });

    if (!membership) {
      await logAccessDenied({
        action: "user.ban",
        actorUserId: currentUser.id,
        targetUserId: targetUser.id,
        summary: `System admin attempted to ban unmanaged department admin ${targetUser.email}.`,
        metadata: {
          actorRole: accessContext.role,
        },
        ...auditRequestContext,
      });

      return c.json(
        {
          success: false,
          message: "Department admin not found.",
          data: null,
        },
        404,
      );
    }
  } else if (accessContext.role === "department_admin") {
    const membership = await db.query.departmentMemberships.findFirst({
      where: and(
        eq(departmentMemberships.userId, parsed.data.userId),
        eq(departmentMemberships.departmentId, accessContext.department.id),
        eq(departmentMemberships.role, "department_staff"),
        eq(departmentMemberships.createdByUserId, currentUser.id),
      ),
      columns: {
        id: true,
      },
    });

    if (!membership) {
      await logAccessDenied({
        action: "user.ban",
        actorUserId: currentUser.id,
        departmentId: accessContext.department.id,
        targetUserId: targetUser.id,
        targetDepartmentId: accessContext.department.id,
        summary: `Department admin attempted to ban unmanaged staff user ${targetUser.email}.`,
        metadata: {
          actorRole: accessContext.role,
        },
        ...auditRequestContext,
      });

      return c.json(
        {
          success: false,
          message: "Department staff not found.",
          data: null,
        },
        404,
      );
    }
  } else {
    await logAccessDenied({
      action: "user.ban",
      actorUserId: currentUser.id,
      targetUserId: targetUser.id,
      summary: `User without admin access attempted to ban ${targetUser.email}.`,
      metadata: {
        actorRole: accessContext.role,
      },
      ...auditRequestContext,
    });

    return c.json(
      {
        success: false,
        message: "You do not have permission to ban users.",
        data: null,
      },
      403,
    );
  }

  const banReason =
    accessContext.role === "system_admin"
      ? "Banned by system admin."
      : "Banned by department admin.";
  const bannedUsers = await db
    .update(users)
    .set({
      banned: true,
      banReason,
      banExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, parsed.data.userId))
    .returning({
      id: users.id,
      email: users.email,
      banned: users.banned,
    });

  const bannedUser = bannedUsers[0];

  if (!bannedUser) {
    return c.json(
      {
        success: false,
        message: "User not found.",
        data: null,
      },
      404,
    );
  }

  const revokedSessions = await db
    .delete(sessions)
    .where(eq(sessions.userId, parsed.data.userId))
    .returning({
      id: sessions.id,
    });

  await createAuditLog({
    action: "user.banned",
    actorUserId: currentUser.id,
    category: "user_management",
    departmentId: accessContext.department?.id ?? null,
    targetType: "user",
    targetId: bannedUser.id,
    targetUserId: bannedUser.id,
    targetDepartmentId: accessContext.department?.id ?? null,
    summary: `Banned user ${bannedUser.email}.`,
    changes: {
      banned: {
        before: targetUser.banned,
        after: true,
      },
      banReason: {
        before: targetUser.banReason,
        after: banReason,
      },
      banExpires: {
        before: targetUser.banExpires?.toISOString() ?? null,
        after: null,
      },
    },
    metadata: {
      actorRole: accessContext.role,
      revokedSessionCount: revokedSessions.length,
    },
    ...auditRequestContext,
  });

  if (revokedSessions.length > 0) {
    await createAuditLog({
      action: "session.revoked",
      actorUserId: currentUser.id,
      category: "auth_security",
      departmentId: accessContext.department?.id ?? null,
      targetType: "session",
      targetId: bannedUser.id,
      targetUserId: bannedUser.id,
      targetDepartmentId: accessContext.department?.id ?? null,
      summary: `Revoked ${revokedSessions.length} session(s) for ${bannedUser.email} during ban.`,
      metadata: {
        actorRole: accessContext.role,
        revokedSessionCount: revokedSessions.length,
        reason: "user_banned",
      },
      ...auditRequestContext,
    });
  }

  return c.json(
    {
      success: true,
      message: "User banned successfully.",
      data: {
        user: {
          id: bannedUser.id,
          email: bannedUser.email,
          isBanned: bannedUser.banned,
        },
      },
    },
    200,
  );
});

accessRoutes.post("/api/access/unban", requireAuth, async (c) => {
  const currentUser = c.get("user");
  const auditRequestContext = getAuditRequestContext(c);
  const payload = await c.req.json().catch(() => null);
  const parsed = BAN_USER_SCHEMA.safeParse(payload);

  if (!currentUser) {
    return c.json(
      {
        success: false,
        message: "You are not signed in.",
        data: null,
      },
      401,
    );
  }

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        message: "Invalid unban payload",
        data: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  const accessContext = await resolveAccessContext(currentUser.id);
  const targetUser = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, parsed.data.userId),
    columns: {
      id: true,
      email: true,
      banned: true,
      banReason: true,
      banExpires: true,
    },
  });

  if (!targetUser) {
    return c.json(
      {
        success: false,
        message: "User not found.",
        data: null,
      },
      404,
    );
  }

  if (accessContext.role === "system_admin") {
    const membership = await db.query.departmentMemberships.findFirst({
      where: and(
        eq(departmentMemberships.userId, parsed.data.userId),
        eq(departmentMemberships.role, "department_admin"),
        eq(departmentMemberships.createdByUserId, currentUser.id),
      ),
      columns: {
        id: true,
      },
    });

    if (!membership) {
      await logAccessDenied({
        action: "user.unban",
        actorUserId: currentUser.id,
        targetUserId: targetUser.id,
        summary: `System admin attempted to unban unmanaged department admin ${targetUser.email}.`,
        metadata: {
          actorRole: accessContext.role,
        },
        ...auditRequestContext,
      });

      return c.json(
        {
          success: false,
          message: "Department admin not found.",
          data: null,
        },
        404,
      );
    }
  } else if (accessContext.role === "department_admin") {
    const membership = await db.query.departmentMemberships.findFirst({
      where: and(
        eq(departmentMemberships.userId, parsed.data.userId),
        eq(departmentMemberships.departmentId, accessContext.department.id),
        eq(departmentMemberships.role, "department_staff"),
        eq(departmentMemberships.createdByUserId, currentUser.id),
      ),
      columns: {
        id: true,
      },
    });

    if (!membership) {
      await logAccessDenied({
        action: "user.unban",
        actorUserId: currentUser.id,
        departmentId: accessContext.department.id,
        targetUserId: targetUser.id,
        targetDepartmentId: accessContext.department.id,
        summary: `Department admin attempted to unban unmanaged staff user ${targetUser.email}.`,
        metadata: {
          actorRole: accessContext.role,
        },
        ...auditRequestContext,
      });

      return c.json(
        {
          success: false,
          message: "Department staff not found.",
          data: null,
        },
        404,
      );
    }
  } else {
    await logAccessDenied({
      action: "user.unban",
      actorUserId: currentUser.id,
      targetUserId: targetUser.id,
      summary: `User without admin access attempted to unban ${targetUser.email}.`,
      metadata: {
        actorRole: accessContext.role,
      },
      ...auditRequestContext,
    });

    return c.json(
      {
        success: false,
        message: "You do not have permission to unban users.",
        data: null,
      },
      403,
    );
  }

  const unbannedUsers = await db
    .update(users)
    .set({
      banned: false,
      banReason: null,
      banExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, parsed.data.userId))
    .returning({
      id: users.id,
      email: users.email,
      banned: users.banned,
    });

  const unbannedUser = unbannedUsers[0];

  if (!unbannedUser) {
    return c.json(
      {
        success: false,
        message: "User not found.",
        data: null,
      },
      404,
    );
  }

  await createAuditLog({
    action: "user.unbanned",
    actorUserId: currentUser.id,
    category: "user_management",
    departmentId: accessContext.department?.id ?? null,
    targetType: "user",
    targetId: unbannedUser.id,
    targetUserId: unbannedUser.id,
    targetDepartmentId: accessContext.department?.id ?? null,
    summary: `Unbanned user ${unbannedUser.email}.`,
    changes: {
      banned: {
        before: targetUser.banned,
        after: false,
      },
      banReason: {
        before: targetUser.banReason,
        after: null,
      },
      banExpires: {
        before: targetUser.banExpires?.toISOString() ?? null,
        after: null,
      },
    },
    metadata: {
      actorRole: accessContext.role,
    },
    ...auditRequestContext,
  });

  return c.json(
    {
      success: true,
      message: "User unbanned successfully.",
      data: {
        user: {
          id: unbannedUser.id,
          email: unbannedUser.email,
          isBanned: unbannedUser.banned,
        },
      },
    },
    200,
  );
});

accessRoutes.post("/api/access/staff", requireAuth, async (c) => {
  const currentUser = c.get("user");
  const auditRequestContext = getAuditRequestContext(c);
  const payload = await c.req.json().catch(() => null);
  const parsed = CREATE_STAFF_SCHEMA.safeParse(payload);

  if (!currentUser) {
    return c.json(
      {
        success: false,
        message: "You are not signed in.",
        data: null,
      },
      401,
    );
  }

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        message: "Invalid staff payload",
        data: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  const accessContext = await resolveAccessContext(currentUser.id);

  if (accessContext.role !== "department_admin") {
    await logAccessDenied({
      action: "user.create",
      actorUserId: currentUser.id,
      departmentId: accessContext.department?.id ?? null,
      targetDepartmentId: accessContext.department?.id ?? null,
      summary: "Non-department-admin attempted to create department staff.",
      metadata: {
        actorRole: accessContext.role,
      },
      ...auditRequestContext,
    });

    return c.json(
      {
        success: false,
        message: "Only department admins can create staff.",
        data: null,
      },
      403,
    );
  }

  try {
    const normalizedUsername = parsed.data.username.trim();

    const authResponse = await auth.api.signUpEmail({
      body: {
        email: parsed.data.email.trim(),
        password: parsed.data.password,
        name: normalizedUsername,
        username: normalizedUsername,
        displayUsername: normalizedUsername,
      },
    });

    await db.insert(departmentMemberships).values({
      departmentId: accessContext.department.id,
      userId: authResponse.user.id,
      role: "department_staff",
      createdByUserId: currentUser.id,
    });

    await createAuditLog({
      action: "user.created",
      actorUserId: currentUser.id,
      category: "user_management",
      departmentId: accessContext.department.id,
      targetType: "user",
      targetId: authResponse.user.id,
      targetUserId: authResponse.user.id,
      targetDepartmentId: accessContext.department.id,
      summary: `Created department staff ${authResponse.user.email}.`,
      metadata: {
        email: authResponse.user.email,
        username: authResponse.user.username ?? null,
        role: "department_staff",
      },
      ...auditRequestContext,
    });

    await createAuditLog({
      action: "membership.created",
      actorUserId: currentUser.id,
      category: "access_control",
      departmentId: accessContext.department.id,
      targetType: "membership",
      targetId: `${accessContext.department.id}:${authResponse.user.id}:department_staff`,
      targetUserId: authResponse.user.id,
      targetDepartmentId: accessContext.department.id,
      summary: `Assigned department_staff membership in ${accessContext.department.name} to ${authResponse.user.email}.`,
      metadata: {
        role: "department_staff",
      },
      ...auditRequestContext,
    });

    return c.json(
      {
        success: true,
        message: "Department staff created successfully.",
        data: {
          department: accessContext.department,
          user: {
            id: authResponse.user.id,
            name: authResponse.user.name,
            email: authResponse.user.email,
            username: authResponse.user.username ?? null,
          },
        },
      },
      201,
    );
  } catch (error) {
    return c.json(
      {
        success: false,
        message: getErrorMessage(error),
        data: null,
      },
      400,
    );
  }
});
