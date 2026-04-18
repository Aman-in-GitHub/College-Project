import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "@/db/schema/auth.ts";
import { departments } from "@/db/schema/department/access.ts";
import {
  createDepartmentIdColumn,
  departmentTimestamp,
  templateColumnTypeEnum,
} from "@/db/schema/department/shared.ts";

export const tableTemplates = pgTable(
  "table_templates",
  {
    id: createDepartmentIdColumn(),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    isArchived: boolean("is_archived").default(false).notNull(),
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
    uniqueIndex("table_templates_department_slug_unique_idx").on(table.departmentId, table.slug),
    index("table_templates_department_id_idx").on(table.departmentId),
  ],
);

export const templateColumns = pgTable(
  "template_columns",
  {
    id: createDepartmentIdColumn(),
    templateId: text("template_id")
      .notNull()
      .references(() => tableTemplates.id, { onDelete: "cascade" }),
    columnKey: text("column_key").notNull(),
    name: text("name").notNull(),
    columnType: templateColumnTypeEnum("column_type").notNull(),
    position: integer("position").notNull(),
    isRequired: boolean("is_required").default(false).notNull(),
    isSearchable: boolean("is_searchable").default(false).notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: departmentTimestamp("created_at").defaultNow().notNull(),
    updatedAt: departmentTimestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("template_columns_template_column_key_unique_idx").on(
      table.templateId,
      table.columnKey,
    ),
    uniqueIndex("template_columns_template_position_unique_idx").on(
      table.templateId,
      table.position,
    ),
    index("template_columns_template_id_idx").on(table.templateId),
  ],
);

export const tableRows = pgTable(
  "table_rows",
  {
    id: createDepartmentIdColumn(),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => tableTemplates.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
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
    index("table_rows_department_id_idx").on(table.departmentId),
    index("table_rows_template_id_idx").on(table.templateId),
    index("table_rows_created_at_idx").on(table.createdAt),
  ],
);

export const tableTemplatesRelations = relations(tableTemplates, ({ many, one }) => ({
  department: one(departments, {
    fields: [tableTemplates.departmentId],
    references: [departments.id],
  }),
  columns: many(templateColumns),
  rows: many(tableRows),
}));

export const templateColumnsRelations = relations(templateColumns, ({ one }) => ({
  template: one(tableTemplates, {
    fields: [templateColumns.templateId],
    references: [tableTemplates.id],
  }),
}));

export const tableRowsRelations = relations(tableRows, ({ one }) => ({
  department: one(departments, {
    fields: [tableRows.departmentId],
    references: [departments.id],
  }),
  template: one(tableTemplates, {
    fields: [tableRows.templateId],
    references: [tableTemplates.id],
  }),
}));
