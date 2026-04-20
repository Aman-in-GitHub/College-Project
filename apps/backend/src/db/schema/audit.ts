import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { users } from "@/db/schema/auth.ts";
import { departments } from "@/db/schema/department/index.ts";

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
    departmentId: text("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    tableName: text("table_name"),
    rowId: text("row_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>().default(null),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_department_id_idx").on(table.departmentId),
    index("audit_logs_actor_user_id_idx").on(table.actorUserId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
