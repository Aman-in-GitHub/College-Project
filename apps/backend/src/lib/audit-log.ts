import { db } from "@/db/index.ts";
import { auditLogs } from "@/db/schema/audit.ts";

export async function createAuditLog(params: {
  action: string;
  actorUserId: string | null;
  departmentId?: string | null;
  tableName?: string | null;
  rowId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(auditLogs).values({
    action: params.action,
    actorUserId: params.actorUserId,
    departmentId: params.departmentId ?? null,
    tableName: params.tableName ?? null,
    rowId: params.rowId ?? null,
    summary: params.summary,
    metadata: params.metadata ?? null,
  });
}
