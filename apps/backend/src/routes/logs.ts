import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "@/types/index.ts";

import { db } from "@/db/index.ts";
import {
  AUDIT_LOG_CATEGORIES,
  AUDIT_LOG_STATUSES,
  AUDIT_LOG_TARGET_TYPES,
  auditLogs,
} from "@/db/schema/audit.ts";
import { users } from "@/db/schema/auth.ts";
import { departments } from "@/db/schema/department/index.ts";
import { requireSystemAdmin } from "@/middlewares/auth.ts";

const AUDIT_LOG_QUERY_SCHEMA = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(200).default(""),
  action: z.string().trim().max(100).default(""),
  category: z.enum(AUDIT_LOG_CATEGORIES).optional(),
  status: z.enum(AUDIT_LOG_STATUSES).optional(),
  targetType: z.enum(AUDIT_LOG_TARGET_TYPES).optional(),
  targetUserId: z.string().trim().max(128).default(""),
  targetDepartmentId: z.string().trim().max(128).default(""),
});

export const logsRoutes = new Hono<AppEnv>();

logsRoutes.get("/api/logs", requireSystemAdmin, async (c) => {
  const parsedQuery = AUDIT_LOG_QUERY_SCHEMA.safeParse(c.req.query());

  if (!parsedQuery.success) {
    return c.json(
      {
        success: false,
        message: "Invalid logs query.",
        data: {
          issues: parsedQuery.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  const {
    page,
    pageSize,
    search,
    action,
    category,
    status,
    targetType,
    targetUserId,
    targetDepartmentId,
  } = parsedQuery.data;
  const offset = (page - 1) * pageSize;
  const conditions = [];

  if (action) {
    conditions.push(eq(auditLogs.action, action));
  }

  if (category) {
    conditions.push(eq(auditLogs.category, category));
  }

  if (status) {
    conditions.push(eq(auditLogs.status, status));
  }

  if (targetType) {
    conditions.push(eq(auditLogs.targetType, targetType));
  }

  if (targetUserId) {
    conditions.push(eq(auditLogs.targetUserId, targetUserId));
  }

  if (targetDepartmentId) {
    conditions.push(eq(auditLogs.targetDepartmentId, targetDepartmentId));
  }

  if (search) {
    const pattern = `%${search}%`;

    conditions.push(
      or(
        ilike(auditLogs.action, pattern),
        ilike(auditLogs.category, pattern),
        ilike(auditLogs.status, pattern),
        ilike(auditLogs.summary, pattern),
        ilike(auditLogs.tableName, pattern),
        ilike(auditLogs.targetId, pattern),
        ilike(users.name, pattern),
        ilike(users.email, pattern),
        ilike(departments.name, pattern),
        ilike(departments.slug, pattern),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [countResult] = await db
    .select({
      total: sql<number>`count(*)::int`,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .leftJoin(departments, eq(auditLogs.departmentId, departments.id))
    .where(whereClause);

  const items = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      category: auditLogs.category,
      status: auditLogs.status,
      summary: auditLogs.summary,
      tableName: auditLogs.tableName,
      rowId: auditLogs.rowId,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      targetUserId: auditLogs.targetUserId,
      targetDepartmentId: auditLogs.targetDepartmentId,
      ipAddress: auditLogs.ipAddress,
      userAgent: auditLogs.userAgent,
      requestId: auditLogs.requestId,
      changes: auditLogs.changes,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actor: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
      department: {
        id: departments.id,
        name: departments.name,
        slug: departments.slug,
      },
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .leftJoin(departments, eq(auditLogs.departmentId, departments.id))
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  return c.json(
    {
      success: true,
      message: "Audit logs loaded successfully.",
      data: {
        items: items.map((item) => ({
          id: item.id,
          action: item.action,
          category: item.category,
          status: item.status,
          summary: item.summary,
          tableName: item.tableName,
          rowId: item.rowId,
          targetType: item.targetType,
          targetId: item.targetId,
          targetUserId: item.targetUserId,
          targetDepartmentId: item.targetDepartmentId,
          ipAddress: item.ipAddress,
          userAgent: item.userAgent,
          requestId: item.requestId,
          changes: item.changes,
          metadata: item.metadata,
          createdAt: item.createdAt.toISOString(),
          actor:
            item.actor !== null && item.actor.id && item.actor.name && item.actor.email
              ? {
                  id: item.actor.id,
                  name: item.actor.name,
                  email: item.actor.email,
                }
              : null,
          department:
            item.department !== null &&
            item.department.id &&
            item.department.name &&
            item.department.slug
              ? {
                  id: item.department.id,
                  name: item.department.name,
                  slug: item.department.slug,
                }
              : null,
        })),
        pagination: {
          page,
          pageSize,
          totalRows: countResult?.total ?? 0,
        },
      },
    },
    200,
  );
});
