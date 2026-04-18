import { pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export function departmentTimestamp(name: string) {
  return timestamp(name, { withTimezone: true });
}

export function createDepartmentIdColumn() {
  return text("id")
    .primaryKey()
    .$defaultFn(() => nanoid(32));
}

export const globalRoleEnum = pgEnum("global_role", ["system_admin"]);
export const departmentRoleEnum = pgEnum("department_role", [
  "department_admin",
  "department_staff",
]);
export const templateColumnTypeEnum = pgEnum("template_column_type", [
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "time",
  "timestamp",
]);
