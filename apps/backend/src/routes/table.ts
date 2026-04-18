import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { AppEnv } from "@/types/index.ts";

import { db, postgresClient } from "@/db/index.ts";
import { DB_COLUMN_TYPES, PG_TYPE_BY_DB_TYPE } from "@/lib/constants.ts";
import { scanExistingTableRowsWithGemini, scanTableImageWithGemini } from "@/lib/table-scan";
import { getIdentifierValidationMessage, normalizeIdentifier, quoteIdentifier } from "@/lib/utils";
import { requireDepartmentAdmin, requireDepartmentStaff } from "@/middlewares/auth.ts";

const CREATE_TABLE_REQUEST_SCHEMA = z.object({
  tableName: z.string().min(1).max(63),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(63),
        type: z.enum(DB_COLUMN_TYPES),
        isRequired: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(200),
  fillData: z.boolean().default(false),
  rows: z.array(z.array(z.string())).default([]),
});

const TABLE_QUERY_SCHEMA = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(200).default(""),
});

const UPDATE_TABLE_ROW_SCHEMA = z.object({
  values: z.record(z.string(), z.string().nullable()),
});

const CREATE_TABLE_ROW_SCHEMA = z.object({
  values: z.record(z.string(), z.string().nullable()),
});

type NormalizedColumn = {
  name: string;
  normalizedName: string;
  type: (typeof DB_COLUMN_TYPES)[number];
  isRequired: boolean;
};

type TableColumn = {
  columnName: string;
  dataType: string;
  isNullable: boolean;
};

function normalizeScannedCellValue(value: string, type: NormalizedColumn["type"]): string | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  if (type === "integer") {
    const normalizedValue = trimmedValue.replace(/,/g, "");
    return normalizedValue || null;
  }

  if (type === "numeric") {
    const normalizedValue = trimmedValue.replace(/[$€£¥₹,\s]/g, "");
    return normalizedValue || null;
  }

  if (type === "boolean") {
    const normalizedValue = trimmedValue.toLowerCase();

    if (["true", "t", "yes", "y", "1"].includes(normalizedValue)) {
      return "true";
    }

    if (["false", "f", "no", "n", "0"].includes(normalizedValue)) {
      return "false";
    }
  }

  return trimmedValue;
}

function buildDepartmentTableName(departmentSlug: string, tableName: string): string | null {
  const normalizedTableName = normalizeIdentifier(tableName);

  if (!normalizedTableName) {
    return null;
  }

  return normalizeIdentifier(`${departmentSlug}_${normalizedTableName}`);
}

function inferEditableColumnType(dataType: string): NormalizedColumn["type"] {
  const normalizedDataType = dataType.toLowerCase();

  if (normalizedDataType.includes("boolean")) {
    return "boolean";
  }

  if (normalizedDataType.includes("timestamp")) {
    return "timestamp";
  }

  if (normalizedDataType === "date") {
    return "date";
  }

  if (normalizedDataType.includes("time")) {
    return "time";
  }

  if (normalizedDataType.includes("numeric") || normalizedDataType.includes("decimal")) {
    return "numeric";
  }

  if (
    normalizedDataType.includes("integer") ||
    normalizedDataType === "bigint" ||
    normalizedDataType === "smallint"
  ) {
    return "integer";
  }

  return "text";
}

async function getDepartmentTableColumns(tableName: string): Promise<TableColumn[]> {
  return postgresClient<TableColumn[]>`
    SELECT
      column_name AS "columnName",
      data_type AS "dataType",
      (is_nullable = 'YES') AS "isNullable"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY ordinal_position ASC
  `;
}

function quoteTableIdentifier(tableName: string): string {
  return quoteIdentifier(tableName);
}

function toSqlLiteral(value: string | null): string {
  if (value === null) {
    return "NULL";
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function buildSearchWhereClause(columns: TableColumn[], search: string): string {
  const trimmedSearch = search.trim();

  if (!trimmedSearch) {
    return "";
  }

  const searchPattern = `%${escapeLikePattern(trimmedSearch)}%`;
  const conditions = columns.map((column) => {
    return `COALESCE(${quoteIdentifier(column.columnName)}::text, '') ILIKE ${toSqlLiteral(searchPattern)} ESCAPE '\\'`;
  });

  return conditions.length > 0 ? `WHERE ${conditions.join(" OR ")}` : "";
}

async function getTableRowById(
  tableName: string,
  rowId: string,
): Promise<Record<string, string | number | boolean | null> | null> {
  const typedRowsQuery = postgresClient<Record<string, string | number | boolean | null>[]>;
  const rows = await typedRowsQuery.unsafe(
    `SELECT * FROM ${quoteTableIdentifier(tableName)} WHERE "id" = ${toSqlLiteral(rowId)} LIMIT 1`,
  );

  return rows[0] ?? null;
}

function normalizeUpdatedCellValue(value: string | null, dataType: string): string | null {
  if (value === null) {
    return null;
  }

  return normalizeScannedCellValue(value, inferEditableColumnType(dataType));
}

function getEditableColumnMap(columns: TableColumn[]): Map<string, TableColumn> {
  return new Map(
    columns
      .filter((column) => column.columnName !== "id")
      .map((column) => [column.columnName, column]),
  );
}

async function deleteTableRowById(tableName: string, rowId: string): Promise<boolean> {
  const typedRowsQuery = postgresClient<{ id: string }[]>;
  const rows = await typedRowsQuery.unsafe(
    `DELETE FROM ${quoteTableIdentifier(tableName)} WHERE "id" = ${toSqlLiteral(rowId)} RETURNING "id"`,
  );

  return rows.length > 0;
}

function buildInsertRowsStatement(
  tableName: string,
  columns: NormalizedColumn[],
  rows: string[][],
) {
  const columnIdentifiers = sql.join(
    [
      sql.raw(quoteIdentifier("id")),
      ...columns.map((column) => sql.raw(quoteIdentifier(column.normalizedName))),
    ],
    sql`, `,
  );

  const rowTuples = rows.map(
    (row) =>
      sql`(${sql.join(
        [
          sql`${nanoid(32)}`,
          ...columns.map((column, columnIndex) => {
            return sql`${normalizeScannedCellValue(row[columnIndex] ?? "", column.type)}`;
          }),
        ],
        sql`, `,
      )})`,
  );

  return sql`INSERT INTO ${sql.raw(quoteIdentifier(tableName))} (${columnIdentifiers}) VALUES ${sql.join(
    rowTuples,
    sql`, `,
  )};`;
}

export const tableRoutes = new Hono<AppEnv>();

tableRoutes.get("/api/tables", requireDepartmentStaff, async (c) => {
  const department = c.get("department");

  if (!department) {
    return c.json(
      {
        success: false,
        message: "Department context is required.",
        data: null,
      },
      400,
    );
  }

  const prefix = `${department.slug}_`;
  const tables = await postgresClient<{ tableName: string }[]>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name LIKE ${`${prefix}%`}
    ORDER BY table_name ASC
  `;

  return c.json(
    {
      success: true,
      message: "Department tables loaded successfully.",
      data: {
        department: {
          id: department.id,
          name: department.name,
          slug: department.slug,
        },
        tables: tables.map((table: { tableName: string }) => ({
          tableName: table.tableName.slice(prefix.length),
          fullTableName: table.tableName,
          href: `/${department.slug}/${table.tableName.slice(prefix.length)}`,
        })),
      },
    },
    200,
  );
});

tableRoutes.get("/api/tables/:tableName", requireDepartmentStaff, async (c) => {
  const department = c.get("department");
  const tableName = c.req.param("tableName");
  const parsedQuery = TABLE_QUERY_SCHEMA.safeParse(c.req.query());

  if (!parsedQuery.success) {
    return c.json(
      {
        success: false,
        message: "Invalid table pagination query.",
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

  if (!department) {
    return c.json(
      {
        success: false,
        message: "Department context is required.",
        data: null,
      },
      400,
    );
  }

  const normalizedDepartmentTableName = buildDepartmentTableName(department.slug, tableName);

  if (!normalizedDepartmentTableName) {
    return c.json(
      {
        success: false,
        message: "Invalid table name.",
        data: null,
      },
      400,
    );
  }

  const columns = await getDepartmentTableColumns(normalizedDepartmentTableName);

  if (columns.length === 0) {
    return c.json(
      {
        success: false,
        message: "Table not found.",
        data: null,
      },
      404,
    );
  }

  const { page, pageSize, search } = parsedQuery.data;
  const offset = (page - 1) * pageSize;
  const quotedTableName = quoteTableIdentifier(normalizedDepartmentTableName);
  const whereClause = buildSearchWhereClause(columns, search);

  const typedCountQuery = postgresClient<{ total: number }[]>;
  const countRows = await typedCountQuery.unsafe(
    `SELECT COUNT(*)::int AS total FROM ${quotedTableName} ${whereClause}`,
  );
  const totalRows = countRows[0]?.total ?? 0;

  const typedRowsQuery = postgresClient<Record<string, string | number | boolean | null>[]>;
  const rows = await typedRowsQuery.unsafe(
    `SELECT * FROM ${quotedTableName} ${whereClause} ORDER BY "id" LIMIT ${pageSize} OFFSET ${offset}`,
  );

  return c.json(
    {
      success: true,
      message: "Table rows loaded successfully.",
      data: {
        department: {
          id: department.id,
          name: department.name,
          slug: department.slug,
        },
        tableName: tableName,
        fullTableName: normalizedDepartmentTableName,
        columns,
        rows,
        pagination: {
          page,
          pageSize,
          totalRows,
        },
      },
    },
    200,
  );
});

tableRoutes.patch("/api/tables/:tableName/rows/:rowId", requireDepartmentAdmin, async (c) => {
  const department = c.get("department");
  const tableName = c.req.param("tableName");
  const rowId = c.req.param("rowId");
  const payload = await c.req.json().catch(() => null);
  const parsedPayload = UPDATE_TABLE_ROW_SCHEMA.safeParse(payload);

  if (!parsedPayload.success) {
    return c.json(
      {
        success: false,
        message: "Invalid row update payload.",
        data: {
          issues: parsedPayload.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  if (!department) {
    return c.json(
      {
        success: false,
        message: "Department context is required.",
        data: null,
      },
      400,
    );
  }

  const normalizedDepartmentTableName = buildDepartmentTableName(department.slug, tableName);

  if (!normalizedDepartmentTableName) {
    return c.json(
      {
        success: false,
        message: "Invalid table name.",
        data: null,
      },
      400,
    );
  }

  const columns = await getDepartmentTableColumns(normalizedDepartmentTableName);

  if (columns.length === 0) {
    return c.json(
      {
        success: false,
        message: "Table not found.",
        data: null,
      },
      404,
    );
  }

  const editableColumns = getEditableColumnMap(columns);

  const normalizedEntries = Object.entries(parsedPayload.data.values)
    .map(([columnName, value]) => {
      const normalizedColumnName = normalizeIdentifier(columnName);

      if (!normalizedColumnName) {
        return null;
      }

      const column = editableColumns.get(normalizedColumnName);

      if (!column) {
        return null;
      }

      return {
        column,
        value: normalizeUpdatedCellValue(value, column.dataType),
      };
    })
    .filter((entry): entry is { column: TableColumn; value: string | null } => entry !== null);

  if (normalizedEntries.length === 0) {
    return c.json(
      {
        success: false,
        message: "No editable columns were provided.",
        data: null,
      },
      400,
    );
  }

  if (normalizedEntries.some((entry) => entry.value === null && !entry.column.isNullable)) {
    return c.json(
      {
        success: false,
        message: "Required fields cannot be empty.",
        data: null,
      },
      400,
    );
  }

  const setClause = normalizedEntries
    .map((entry) => `${quoteIdentifier(entry.column.columnName)} = ${toSqlLiteral(entry.value)}`)
    .join(", ");

  const quotedTableName = quoteTableIdentifier(normalizedDepartmentTableName);

  await postgresClient.unsafe(
    `UPDATE ${quotedTableName} SET ${setClause} WHERE "id" = ${toSqlLiteral(rowId)}`,
  );

  return c.json(
    {
      success: true,
      message: "Row updated successfully.",
      data: {
        row: await getTableRowById(normalizedDepartmentTableName, rowId),
      },
    },
    200,
  );
});

tableRoutes.post("/api/tables/:tableName/rows", requireDepartmentAdmin, async (c) => {
  const department = c.get("department");
  const tableName = c.req.param("tableName");
  const payload = await c.req.json().catch(() => null);
  const parsedPayload = CREATE_TABLE_ROW_SCHEMA.safeParse(payload);

  if (!parsedPayload.success) {
    return c.json(
      {
        success: false,
        message: "Invalid create-row payload.",
        data: {
          issues: parsedPayload.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  if (!department) {
    return c.json(
      {
        success: false,
        message: "Department context is required.",
        data: null,
      },
      400,
    );
  }

  const normalizedDepartmentTableName = buildDepartmentTableName(department.slug, tableName);

  if (!normalizedDepartmentTableName) {
    return c.json(
      {
        success: false,
        message: "Invalid table name.",
        data: null,
      },
      400,
    );
  }

  const columns = await getDepartmentTableColumns(normalizedDepartmentTableName);

  if (columns.length === 0) {
    return c.json(
      {
        success: false,
        message: "Table not found.",
        data: null,
      },
      404,
    );
  }

  const quotedTableName = quoteTableIdentifier(normalizedDepartmentTableName);
  const rowId = nanoid(32);
  const editableColumns = columns.filter((column) => column.columnName !== "id");
  const editableColumnMap = getEditableColumnMap(columns);
  const normalizedEntries = Object.entries(parsedPayload.data.values)
    .map(([columnName, value]) => {
      const normalizedColumnName = normalizeIdentifier(columnName);

      if (!normalizedColumnName) {
        return null;
      }

      const column = editableColumnMap.get(normalizedColumnName);

      if (!column) {
        return null;
      }

      return {
        column,
        value: normalizeUpdatedCellValue(value, column.dataType),
      };
    })
    .filter((entry): entry is { column: TableColumn; value: string | null } => entry !== null);

  if (normalizedEntries.every((entry) => entry.value === null)) {
    return c.json(
      {
        success: false,
        message: "At least one field is required.",
        data: null,
      },
      400,
    );
  }

  if (
    editableColumns.some(
      (column) =>
        !column.isNullable &&
        (normalizedEntries.find((entry) => entry.column.columnName === column.columnName)?.value ??
          null) === null,
    )
  ) {
    return c.json(
      {
        success: false,
        message: "Required fields are missing.",
        data: null,
      },
      400,
    );
  }

  const valuesByColumn = new Map(
    normalizedEntries.map((entry) => [entry.column.columnName, entry.value]),
  );
  const insertColumns = [
    quoteIdentifier("id"),
    ...editableColumns.map((column) => quoteIdentifier(column.columnName)),
  ];
  const insertValues = [
    toSqlLiteral(rowId),
    ...editableColumns.map((column) => toSqlLiteral(valuesByColumn.get(column.columnName) ?? null)),
  ];

  await postgresClient.unsafe(
    `INSERT INTO ${quotedTableName} (${insertColumns.join(", ")}) VALUES (${insertValues.join(", ")})`,
  );

  return c.json(
    {
      success: true,
      message: "Record added successfully.",
      data: {
        row: await getTableRowById(normalizedDepartmentTableName, rowId),
      },
    },
    201,
  );
});

tableRoutes.delete("/api/tables/:tableName/rows/:rowId", requireDepartmentAdmin, async (c) => {
  const department = c.get("department");
  const tableName = c.req.param("tableName");
  const rowId = c.req.param("rowId");

  if (!department) {
    return c.json(
      {
        success: false,
        message: "Department context is required.",
        data: null,
      },
      400,
    );
  }

  const normalizedDepartmentTableName = buildDepartmentTableName(department.slug, tableName);

  if (!normalizedDepartmentTableName) {
    return c.json(
      {
        success: false,
        message: "Invalid table name.",
        data: null,
      },
      400,
    );
  }

  const columns = await getDepartmentTableColumns(normalizedDepartmentTableName);

  if (columns.length === 0) {
    return c.json(
      {
        success: false,
        message: "Table not found.",
        data: null,
      },
      404,
    );
  }

  const isDeleted = await deleteTableRowById(normalizedDepartmentTableName, rowId);

  if (!isDeleted) {
    return c.json(
      {
        success: false,
        message: "Row not found.",
        data: null,
      },
      404,
    );
  }

  return c.json(
    {
      success: true,
      message: "Row deleted successfully.",
      data: null,
    },
    200,
  );
});

tableRoutes.post("/api/tables/:tableName/import-image", requireDepartmentAdmin, async (c) => {
  const reqLogger = c.get("logger");
  const department = c.get("department");
  const tableName = c.req.param("tableName");
  const body = await c.req.parseBody();
  const maybeFile = body.file;
  const file = Array.isArray(maybeFile) ? maybeFile[0] : maybeFile;

  if (!(file instanceof File)) {
    return c.json(
      {
        success: false,
        message: "Missing file field in multipart request",
        data: null,
      },
      400,
    );
  }

  if (!file.type.startsWith("image/")) {
    return c.json(
      {
        success: false,
        message: "Only image files are supported",
        data: null,
      },
      400,
    );
  }

  if (!department) {
    return c.json(
      {
        success: false,
        message: "Department context is required.",
        data: null,
      },
      400,
    );
  }

  const normalizedDepartmentTableName = buildDepartmentTableName(department.slug, tableName);

  if (!normalizedDepartmentTableName) {
    return c.json(
      {
        success: false,
        message: "Invalid table name.",
        data: null,
      },
      400,
    );
  }

  const columns = await getDepartmentTableColumns(normalizedDepartmentTableName);

  if (columns.length === 0) {
    return c.json(
      {
        success: false,
        message: "Table not found.",
        data: null,
      },
      404,
    );
  }

  const editableColumns = columns.filter((column) => column.columnName !== "id");
  const scannedRows = await scanExistingTableRowsWithGemini({
    file,
    logger: reqLogger,
    tableName,
    columns: editableColumns.map((column) => ({
      name: column.columnName,
      dataType: column.dataType,
      isNullable: column.isNullable,
    })),
  });

  if (scannedRows.length === 0) {
    return c.json(
      {
        success: true,
        message: "No matching table rows were found in the uploaded image.",
        data: {
          insertedRowCount: 0,
        },
      },
      200,
    );
  }

  if (
    scannedRows.some((row) =>
      editableColumns.some(
        (column, columnIndex) =>
          !column.isNullable &&
          normalizeUpdatedCellValue(row[columnIndex] ?? "", column.dataType) === null,
      ),
    )
  ) {
    return c.json(
      {
        success: false,
        message: "Required fields are missing in the imported image rows.",
        data: null,
      },
      400,
    );
  }

  const columnIdentifiers = [
    quoteIdentifier("id"),
    ...editableColumns.map((column) => quoteIdentifier(column.columnName)),
  ];
  const rowValues = scannedRows.map((row) => {
    return [
      toSqlLiteral(nanoid(32)),
      ...editableColumns.map((column, columnIndex) =>
        toSqlLiteral(normalizeUpdatedCellValue(row[columnIndex] ?? "", column.dataType)),
      ),
    ];
  });

  await postgresClient.unsafe(
    `INSERT INTO ${quoteTableIdentifier(normalizedDepartmentTableName)} (${columnIdentifiers.join(", ")}) VALUES ${rowValues
      .map((row) => `(${row.join(", ")})`)
      .join(", ")}`,
  );

  return c.json(
    {
      success: true,
      message: `${scannedRows.length} row(s) imported successfully.`,
      data: {
        insertedRowCount: scannedRows.length,
      },
    },
    201,
  );
});

tableRoutes.post("/api/table/scan", requireDepartmentAdmin, async (c) => {
  const reqLogger = c.get("logger");
  const department = c.get("department");
  const body = await c.req.parseBody();
  const maybeFile = body.file;
  const file = Array.isArray(maybeFile) ? maybeFile[0] : maybeFile;

  reqLogger.info(
    {
      route: "/api/table/scan",
      departmentId: department?.id ?? null,
      departmentSlug: department?.slug ?? null,
      hasFile: file instanceof File,
      fileName: file instanceof File ? file.name : null,
      fileType: file instanceof File ? file.type : null,
      fileSize: file instanceof File ? file.size : null,
    },
    "Received table scan request",
  );

  if (!(file instanceof File)) {
    return c.json(
      {
        success: false,
        message: "Missing file field in multipart request",
        data: null,
      },
      400,
    );
  }

  if (!file.type.startsWith("image/")) {
    return c.json(
      {
        success: false,
        message: "Only image files are supported",
        data: null,
      },
      400,
    );
  }

  const tables = await scanTableImageWithGemini(file, reqLogger);

  reqLogger.info(
    {
      route: "/api/table/scan",
      detectedTableCount: tables.length,
      detectedColumnCount: tables.reduce((total, table) => total + table.columns.length, 0),
      detectedTables: tables.map((table, tableIndex) => ({
        table: tableIndex + 1,
        columns: table.columns.map((column) => ({
          name: column.name,
          inferredType: column.inferredType,
        })),
      })),
    },
    "Parsed scan result",
  );

  return c.json(
    {
      success: true,
      message: tables.length > 0 ? "Table scan complete" : "No table found in the uploaded image",
      data: {
        department: department
          ? {
              id: department.id,
              slug: department.slug,
              name: department.name,
            }
          : null,
        tables,
        columnTypes: DB_COLUMN_TYPES,
      },
    },
    200,
  );
});

tableRoutes.post("/api/table/create", requireDepartmentAdmin, async (c) => {
  const reqLogger = c.get("logger");
  const department = c.get("department");
  const payload = await c.req.json().catch(() => null);
  const parsed = CREATE_TABLE_REQUEST_SCHEMA.safeParse(payload);

  reqLogger.info(
    {
      route: "/api/table/create",
      departmentId: department?.id ?? null,
      departmentSlug: department?.slug ?? null,
      hasPayload: payload !== null,
      requestedTableName:
        payload && typeof payload === "object" && "tableName" in payload
          ? String(payload.tableName ?? "")
          : null,
    },
    "Received table create request",
  );

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        message: "Invalid create-table payload",
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

  if (!department) {
    return c.json(
      {
        success: false,
        message: "Department context is required for table creation.",
        data: null,
      },
      400,
    );
  }

  const normalizedBaseTableName = normalizeIdentifier(parsed.data.tableName);

  if (!normalizedBaseTableName) {
    reqLogger.warn(
      {
        route: "/api/table/create",
        departmentId: department.id,
        departmentSlug: department.slug,
        requestedTableName: parsed.data.tableName,
        reason: getIdentifierValidationMessage(parsed.data.tableName),
      },
      "Invalid table name",
    );

    return c.json(
      {
        success: false,
        message: "Invalid tableName. Use letters, numbers, underscores, and start with a letter.",
        data: null,
      },
      400,
    );
  }

  const normalizedTableName = normalizeIdentifier(`${department.slug}_${normalizedBaseTableName}`);

  if (!normalizedTableName) {
    return c.json(
      {
        success: false,
        message:
          "The final table name is too long after adding the department prefix. Use a shorter table name.",
        data: null,
      },
      400,
    );
  }

  const candidateColumns = parsed.data.columns.map((column) => ({
    ...column,
    normalizedName: normalizeIdentifier(column.name),
  }));

  const invalidColumns = candidateColumns
    .filter((column) => !column.normalizedName)
    .map((column) => ({
      name: column.name,
      reason: getIdentifierValidationMessage(column.name),
    }));

  if (invalidColumns.length > 0) {
    reqLogger.warn(
      {
        route: "/api/table/create",
        invalidColumns,
      },
      "Invalid column names",
    );

    return c.json(
      {
        success: false,
        message: invalidColumns.map((column) => `${column.name}: ${column.reason}`).join("; "),
        data: {
          issues: invalidColumns.map((column) => ({
            path: column.name,
            message: column.reason,
          })),
        },
      },
      400,
    );
  }

  const normalizedColumns: NormalizedColumn[] = candidateColumns.flatMap((column) =>
    column.normalizedName ? [{ ...column, normalizedName: column.normalizedName }] : [],
  );

  const duplicateColumn = normalizedColumns.find(
    (column, index) =>
      normalizedColumns.findIndex(
        (candidate) => candidate.normalizedName === column.normalizedName,
      ) !== index,
  );

  if (duplicateColumn) {
    reqLogger.warn(
      {
        route: "/api/table/create",
        duplicateColumn: duplicateColumn.name,
        normalizedName: duplicateColumn.normalizedName,
      },
      "Duplicate column name detected",
    );

    return c.json(
      {
        success: false,
        message: `Duplicate column name detected: ${duplicateColumn.name}`,
        data: null,
      },
      400,
    );
  }

  if (normalizedColumns.some((column) => column.normalizedName === "id")) {
    return c.json(
      {
        success: false,
        message: "Column name id is reserved. It is added automatically.",
        data: null,
      },
      400,
    );
  }

  const columnDefinitions = [
    `${quoteIdentifier("id")} TEXT PRIMARY KEY`,
    ...normalizedColumns.map((column) => {
      const sqlType = PG_TYPE_BY_DB_TYPE[column.type];
      return `${quoteIdentifier(column.normalizedName)} ${sqlType}${column.isRequired ? " NOT NULL" : ""}`;
    }),
  ];

  const createTableStatement = `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(
    normalizedTableName,
  )} (${columnDefinitions.join(", ")});`;

  const rowsToInsert = parsed.data.rows
    .map((row) => normalizedColumns.map((_, columnIndex) => row[columnIndex] ?? ""))
    .filter((row) => row.some((value) => value.trim().length > 0));

  const requiredColumnIndexes = normalizedColumns
    .map((column, index) => (column.isRequired ? index : -1))
    .filter((index) => index >= 0);

  if (
    parsed.data.fillData &&
    rowsToInsert.some((row) =>
      requiredColumnIndexes.some(
        (columnIndex) =>
          normalizeScannedCellValue(
            row[columnIndex] ?? "",
            normalizedColumns[columnIndex]!.type,
          ) === null,
      ),
    )
  ) {
    return c.json(
      {
        success: false,
        message: "Required columns contain empty values in scanned rows.",
        data: null,
      },
      400,
    );
  }

  reqLogger.info(
    {
      route: "/api/table/create",
      departmentId: department.id,
      departmentSlug: department.slug,
      normalizedTableName,
      normalizedColumns: normalizedColumns.map((column) => ({
        originalName: column.name,
        normalizedName: column.normalizedName,
        type: column.type,
        isRequired: column.isRequired,
      })),
      fillData: parsed.data.fillData,
      requestedRowCount: parsed.data.rows.length,
      insertedRowCount: parsed.data.fillData ? rowsToInsert.length : 0,
      createTableStatement,
    },
    "Executing create table statement",
  );

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(createTableStatement));

      if (parsed.data.fillData && rowsToInsert.length > 0) {
        await tx.execute(
          buildInsertRowsStatement(normalizedTableName, normalizedColumns, rowsToInsert),
        );
      }
    });
  } catch (error) {
    reqLogger.error(
      {
        route: "/api/table/create",
        tableName: normalizedTableName,
        fillData: parsed.data.fillData,
        insertedRowCount: parsed.data.fillData ? rowsToInsert.length : 0,
        error,
      },
      "Failed to create table or insert scanned data",
    );

    return c.json(
      {
        success: false,
        message: parsed.data.fillData
          ? "Table creation failed while inserting scanned photo data. Check the detected column types and values."
          : "Table creation failed",
        data: null,
      },
      400,
    );
  }

  reqLogger.info(
    {
      route: "/api/table/create",
      tableName: normalizedTableName,
      columnCount: normalizedColumns.length,
      insertedRowCount: parsed.data.fillData ? rowsToInsert.length : 0,
    },
    "Table created",
  );

  const successMessage =
    parsed.data.fillData && rowsToInsert.length > 0
      ? `Table created and ${rowsToInsert.length} rows inserted successfully`
      : "Table created successfully";

  return c.json(
    {
      success: true,
      message: successMessage,
      data: {
        department: {
          id: department.id,
          slug: department.slug,
          name: department.name,
        },
        baseTableName: normalizedBaseTableName,
        tableName: normalizedTableName,
        columns: normalizedColumns.map((column) => ({
          name: column.normalizedName,
          type: column.type,
          isRequired: column.isRequired,
        })),
      },
    },
    201,
  );
});
