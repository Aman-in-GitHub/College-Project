import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "@/db/schema/auth.ts";
import {
  createDepartmentIdColumn,
  departmentRoleEnum,
  departmentTimestamp,
  globalRoleEnum,
} from "@/db/schema/department/shared.ts";

export const departments = pgTable(
  "departments",
  {
    id: createDepartmentIdColumn(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: departmentTimestamp("created_at").defaultNow().notNull(),
    updatedAt: departmentTimestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("departments_slug_unique_idx").on(table.slug),
    index("departments_is_active_idx").on(table.isActive),
  ],
);

export const userGlobalRoles = pgTable(
  "user_global_roles",
  {
    id: createDepartmentIdColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: globalRoleEnum("role").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: departmentTimestamp("created_at").defaultNow().notNull(),
    updatedAt: departmentTimestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_global_roles_user_id_role_unique_idx").on(table.userId, table.role),
    index("user_global_roles_user_id_idx").on(table.userId),
  ],
);

export const departmentMemberships = pgTable(
  "department_memberships",
  {
    id: createDepartmentIdColumn(),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: departmentRoleEnum("role").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: departmentTimestamp("created_at").defaultNow().notNull(),
    updatedAt: departmentTimestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("department_memberships_department_user_unique_idx").on(
      table.departmentId,
      table.userId,
    ),
    index("department_memberships_user_id_idx").on(table.userId),
    index("department_memberships_department_id_idx").on(table.departmentId),
  ],
);

export const departmentsRelations = relations(departments, ({ many }) => ({
  memberships: many(departmentMemberships),
}));

export const userGlobalRolesRelations = relations(userGlobalRoles, ({ one }) => ({
  user: one(users, {
    fields: [userGlobalRoles.userId],
    references: [users.id],
  }),
}));

export const departmentMembershipsRelations = relations(departmentMemberships, ({ one }) => ({
  department: one(departments, {
    fields: [departmentMemberships.departmentId],
    references: [departments.id],
  }),
  user: one(users, {
    fields: [departmentMemberships.userId],
    references: [users.id],
  }),
}));

export type GlobalRole = (typeof globalRoleEnum.enumValues)[number];
export type DepartmentRole = (typeof departmentRoleEnum.enumValues)[number];
export type Department = typeof departments.$inferSelect;
export type DepartmentMembership = typeof departmentMemberships.$inferSelect;
