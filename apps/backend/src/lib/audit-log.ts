import type { Context } from "hono";

import type { AuditLogCategory, AuditLogStatus, AuditLogTargetType } from "@/db/schema/audit.ts";
import type { AppEnv } from "@/types/index.ts";

import { db } from "@/db/index.ts";
import { auditLogs } from "@/db/schema/audit.ts";
import { getClientIp } from "@/lib/utils.ts";

type CreateAuditLogParams = {
  action: string;
  actorUserId: string | null;
  category?: AuditLogCategory;
  status?: AuditLogStatus;
  departmentId?: string | null;
  tableName?: string | null;
  rowId?: string | null;
  targetType?: AuditLogTargetType | null;
  targetId?: string | null;
  targetUserId?: string | null;
  targetDepartmentId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  summary: string;
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export function getAuditRequestContext(
  c: Context<AppEnv>,
): Pick<CreateAuditLogParams, "ipAddress" | "requestId" | "userAgent"> {
  const userAgent = c.req.header("user-agent")?.trim() ?? "";
  const requestId = c.req.header("x-request-id")?.trim() ?? "";

  return {
    ipAddress: getClientIp(c),
    requestId: requestId.length > 0 ? requestId : null,
    userAgent: userAgent.length > 0 ? userAgent : null,
  };
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  await db.insert(auditLogs).values({
    action: params.action,
    actorUserId: params.actorUserId,
    category: params.category ?? "data",
    status: params.status ?? "success",
    departmentId: params.departmentId ?? null,
    tableName: params.tableName ?? null,
    rowId: params.rowId ?? null,
    targetType: params.targetType ?? null,
    targetId: params.targetId ?? null,
    targetUserId: params.targetUserId ?? null,
    targetDepartmentId: params.targetDepartmentId ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    requestId: params.requestId ?? null,
    summary: params.summary,
    changes: params.changes ?? null,
    metadata: params.metadata ?? null,
  });
}
