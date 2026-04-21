import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { users } from "@/db/schema/auth.ts";
import { departments } from "@/db/schema/department/index.ts";

export const AUDIT_LOG_CATEGORIES = [
  "access_control",
  "auth_security",
  "data",
  "import_export",
  "user_management",
] as const;

export const AUDIT_LOG_STATUSES = ["success", "denied", "failed"] as const;

export const AUDIT_LOG_TARGET_TYPES = [
  "auth",
  "department",
  "membership",
  "session",
  "table",
  "table_row",
  "user",
] as const;

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid(32)),
    action: text("action").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    category: text("category", {
      enum: AUDIT_LOG_CATEGORIES,
    })
      .default("data")
      .notNull(),
    status: text("status", {
      enum: AUDIT_LOG_STATUSES,
    })
      .default("success")
      .notNull(),
    departmentId: text("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    tableName: text("table_name"),
    rowId: text("row_id"),
    targetType: text("target_type", {
      enum: AUDIT_LOG_TARGET_TYPES,
    }),
    targetId: text("target_id"),
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetDepartmentId: text("target_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    summary: text("summary").notNull(),
    changes: jsonb("changes").$type<Record<string, unknown> | null>().default(null),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>().default(null),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_category_created_at_idx").on(table.category, table.createdAt),
    index("audit_logs_status_created_at_idx").on(table.status, table.createdAt),
    index("audit_logs_department_id_idx").on(table.departmentId),
    index("audit_logs_target_department_id_created_at_idx").on(
      table.targetDepartmentId,
      table.createdAt,
    ),
    index("audit_logs_actor_user_id_idx").on(table.actorUserId),
    index("audit_logs_target_user_id_created_at_idx").on(table.targetUserId, table.createdAt),
  ],
);

export type AuditLogCategory = (typeof AUDIT_LOG_CATEGORIES)[number];
export type AuditLog = typeof auditLogs.$inferSelect;
export type AuditLogStatus = (typeof AUDIT_LOG_STATUSES)[number];
export type AuditLogTargetType = (typeof AUDIT_LOG_TARGET_TYPES)[number];
