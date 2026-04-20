import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { AppEnv } from "@/types/index.ts";
import type { ScannedTable } from "@/types/table.ts";

import { db, postgresClient } from "@/db/index.ts";
import { createAuditLog } from "@/lib/audit-log.ts";
import { DB_COLUMN_TYPES, PG_TYPE_BY_DB_TYPE } from "@/lib/constants.ts";
import {
  scanExistingTableRowsWithGemini,
  scanTableImageWithGemini,
  scanTableImageWithPaddle,
} from "@/lib/table-scan";
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

const TABLE_SCAN_SOURCE_SCHEMA = z.object({
  source: z.enum(["gemini", "paddle"]).default("gemini"),
});

const IMPORT_PREVIEW_ROW_SCHEMA = z.object({
  values: z.record(z.string(), z.string().nullable()),
});

const IMPORT_IMAGE_COMMIT_SCHEMA = z.object({
  rows: z.array(IMPORT_PREVIEW_ROW_SCHEMA).min(1).max(1000),
  source: z.enum(["gemini", "paddle"]).default("gemini"),
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

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DuplicateReason = "existing_row" | "batch_duplicate" | null;
type ImportPreviewRow = {
  values: Record<string, string | null>;
  missingRequiredColumns: string[];
  duplicateReason: DuplicateReason;
};

const SYSTEM_TABLE_COLUMN_NAMES = new Set([
  "id",
  "created_at",
  "updated_at",
  "department_id",
  "created_by_user_id",
]);

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
  const columns = await postgresClient<TableColumn[]>`
    SELECT
      column_name AS "columnName",
      data_type AS "dataType",
      (is_nullable = 'YES') AS "isNullable"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY ordinal_position ASC
  `;

  return columns.filter((column) => !SYSTEM_TABLE_COLUMN_NAMES.has(column.columnName));
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
  return new Map(columns.map((column) => [column.columnName, column]));
}

async function ensureSystemTableColumns(params: {
  tableName: string;
  departmentId: string;
  createdByUserId: string | null;
  tx?: DbTransaction;
}): Promise<void> {
  const quotedTableName = quoteTableIdentifier(params.tableName);
  const departmentIdLiteral = toSqlLiteral(params.departmentId);
  const createdByUserIdLiteral = toSqlLiteral(params.createdByUserId);
  const executeStatement = async (statement: string): Promise<void> => {
    if (params.tx) {
      await params.tx.execute(sql.raw(statement));
      return;
    }

    await postgresClient.unsafe(statement);
  };

  await executeStatement(
    `ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS ${quoteIdentifier("created_at")} TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  );
  await executeStatement(
    `ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS ${quoteIdentifier("updated_at")} TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  );
  await executeStatement(
    `ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS ${quoteIdentifier("department_id")} TEXT`,
  );
  await executeStatement(
    `ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS ${quoteIdentifier("created_by_user_id")} TEXT`,
  );
  await executeStatement(
    `UPDATE ${quotedTableName} SET ${quoteIdentifier("department_id")} = ${departmentIdLiteral} WHERE ${quoteIdentifier("department_id")} IS NULL`,
  );
  await executeStatement(
    `UPDATE ${quotedTableName} SET ${quoteIdentifier("created_by_user_id")} = ${createdByUserIdLiteral} WHERE ${quoteIdentifier("created_by_user_id")} IS NULL`,
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
  departmentId: string,
  createdByUserId: string | null,
  columns: NormalizedColumn[],
  rows: string[][],
) {
  const columnIdentifiers = sql.join(
    [
      sql.raw(quoteIdentifier("id")),
      sql.raw(quoteIdentifier("created_at")),
      sql.raw(quoteIdentifier("updated_at")),
      sql.raw(quoteIdentifier("department_id")),
      sql.raw(quoteIdentifier("created_by_user_id")),
      ...columns.map((column) => sql.raw(quoteIdentifier(column.normalizedName))),
    ],
    sql`, `,
  );

  const rowTuples = rows.map(
    (row) =>
      sql`(${sql.join(
        [
          sql`${nanoid(32)}`,
          sql`NOW()`,
          sql`NOW()`,
          sql`${departmentId}`,
          sql`${createdByUserId}`,
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

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let currentCell = "";
  let isInsideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const currentCharacter = line[index] ?? "";
    const nextCharacter = line[index + 1] ?? "";

    if (currentCharacter === '"') {
      if (isInsideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }

      isInsideQuotes = !isInsideQuotes;
      continue;
    }

    if (currentCharacter === "," && !isInsideQuotes) {
      cells.push(currentCell);
      currentCell = "";
      continue;
    }

    currentCell += currentCharacter;
  }

  cells.push(currentCell);

  return cells.map((cell) => cell.trim());
}

function parseCsvContent(content: string): string[][] {
  const normalizedContent = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalizedContent
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  return lines.map((line) => parseCsvLine(line));
}

async function insertEditableRows(params: {
  tableName: string;
  departmentId: string;
  createdByUserId: string | null;
  editableColumns: TableColumn[];
  rows: Array<Array<string | null>>;
  tx?: DbTransaction;
}): Promise<number> {
  if (params.rows.length === 0) {
    return 0;
  }

  const columnIdentifiers = [
    quoteIdentifier("id"),
    quoteIdentifier("created_at"),
    quoteIdentifier("updated_at"),
    quoteIdentifier("department_id"),
    quoteIdentifier("created_by_user_id"),
    ...params.editableColumns.map((column) => quoteIdentifier(column.columnName)),
  ];
  const rowValues = params.rows.map((row) => {
    return [
      toSqlLiteral(nanoid(32)),
      "NOW()",
      "NOW()",
      toSqlLiteral(params.departmentId),
      toSqlLiteral(params.createdByUserId),
      ...params.editableColumns.map((_, columnIndex) => toSqlLiteral(row[columnIndex] ?? null)),
    ];
  });

  const insertStatement = `INSERT INTO ${quoteTableIdentifier(params.tableName)} (${columnIdentifiers.join(", ")}) VALUES ${rowValues
    .map((row) => `(${row.join(", ")})`)
    .join(", ")}`;

  if (params.tx) {
    await params.tx.execute(sql.raw(insertStatement));
  } else {
    await postgresClient.unsafe(insertStatement);
  }

  return params.rows.length;
}

function normalizeImportColumnName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getScanRows(columns: ScannedTable["columns"]): string[][] {
  const rowCount = columns.reduce(
    (maxCount, column) => Math.max(maxCount, column.values.length),
    0,
  );

  return Array.from({ length: rowCount }, (_, rowIndex) =>
    columns.map((column) => column.values[rowIndex] ?? ""),
  );
}

function selectBestMatchingScanTable(
  tables: ScannedTable[],
  columns: TableColumn[],
): ScannedTable | null {
  if (tables.length === 0) {
    return null;
  }

  const editableColumnNames = new Set(
    columns.map((column) => normalizeImportColumnName(column.columnName)),
  );
  const rankedTables = tables.map((table) => ({
    table,
    matchCount: table.columns.reduce((count, column) => {
      return count + (editableColumnNames.has(normalizeImportColumnName(column.name)) ? 1 : 0);
    }, 0),
  }));

  rankedTables.sort((left, right) => right.matchCount - left.matchCount);

  return rankedTables[0]?.table ?? null;
}

function buildImportedRowsFromScan(scanTable: ScannedTable, columns: TableColumn[]) {
  const scannedColumnMap = new Map(
    scanTable.columns.map((column) => [normalizeImportColumnName(column.name), column]),
  );
  const scanRows = getScanRows(scanTable.columns);

  return scanRows
    .map((_, rowIndex) => {
      return columns.map((column) => {
        const scannedColumn = scannedColumnMap.get(normalizeImportColumnName(column.columnName));
        const nextValue = scannedColumn?.values[rowIndex]?.trim() ?? "";

        return normalizeUpdatedCellValue(nextValue.length > 0 ? nextValue : null, column.dataType);
      });
    })
    .filter((row) => row.some((value) => value !== null));
}

function buildRowSignature(row: Array<string | null>): string {
  return JSON.stringify(row.map((value) => value ?? null));
}

async function getExistingRowSignatures(
  tableName: string,
  columns: TableColumn[],
): Promise<Set<string>> {
  if (columns.length === 0) {
    return new Set();
  }

  const typedRowsQuery = postgresClient<Record<string, string | number | boolean | null>[]>;
  const columnSelections = columns.map((column) => quoteIdentifier(column.columnName)).join(", ");
  const rows = await typedRowsQuery.unsafe(
    `SELECT ${columnSelections} FROM ${quoteTableIdentifier(tableName)}`,
  );

  return new Set(
    rows.map((row) =>
      buildRowSignature(
        columns.map((column) => {
          const value = row[column.columnName];
          return value === null || value === undefined ? null : String(value);
        }),
      ),
    ),
  );
}

function toImportPreviewRows(
  rows: Array<Array<string | null>>,
  columns: TableColumn[],
  existingSignatures: Set<string>,
): ImportPreviewRow[] {
  const batchSignatures = new Set<string>();

  return rows.map((row) => {
    const signature = buildRowSignature(row);
    const missingRequiredColumns = columns
      .filter((column, index) => !column.isNullable && row[index] === null)
      .map((column) => column.columnName);
    let duplicateReason: DuplicateReason = null;

    if (existingSignatures.has(signature)) {
      duplicateReason = "existing_row";
    } else if (batchSignatures.has(signature)) {
      duplicateReason = "batch_duplicate";
    } else {
      batchSignatures.add(signature);
    }

    return {
      values: Object.fromEntries(
        columns.map((column, index) => [column.columnName, row[index] ?? null]),
      ),
      missingRequiredColumns,
      duplicateReason,
    };
  });
}

function summarizePreviewRows(rows: ImportPreviewRow[]) {
  return {
    totalRows: rows.length,
    duplicateRows: rows.filter((row) => row.duplicateReason !== null).length,
    rowsWithMissingRequiredValues: rows.filter((row) => row.missingRequiredColumns.length > 0)
      .length,
    readyRows: rows.filter(
      (row) => row.duplicateReason === null && row.missingRequiredColumns.length === 0,
    ).length,
  };
}

function normalizeCommittedImportRows(
  rows: Array<{ values: Record<string, string | null> }>,
  columns: TableColumn[],
) {
  return rows.map((row, rowIndex) => {
    const values = columns.map((column) =>
      normalizeUpdatedCellValue(row.values[column.columnName] ?? null, column.dataType),
    );
    const missingRequiredColumns = columns
      .filter((column, columnIndex) => !column.isNullable && values[columnIndex] === null)
      .map((column) => column.columnName);

    return {
      rowIndex,
      values,
      missingRequiredColumns,
    };
  });
}

async function buildImageImportPreview(params: {
  file: File;
  logger: AppEnv["Variables"]["logger"];
  source: "gemini" | "paddle";
  tableName: string;
  normalizedDepartmentTableName: string;
  editableColumns: TableColumn[];
}): Promise<ImportPreviewRow[]> {
  const normalizedRows =
    params.source === "paddle"
      ? await (async () => {
          const scannedTables = await scanTableImageWithPaddle(params.file, params.logger);
          const scanTable = selectBestMatchingScanTable(scannedTables, params.editableColumns);

          if (scanTable === null) {
            return [];
          }

          return buildImportedRowsFromScan(scanTable, params.editableColumns);
        })()
      : (
          await scanExistingTableRowsWithGemini({
            file: params.file,
            logger: params.logger,
            tableName: params.tableName,
            columns: params.editableColumns.map((column) => ({
              name: column.columnName,
              dataType: column.dataType,
              isNullable: column.isNullable,
            })),
          })
        ).map((row) =>
          params.editableColumns.map((column, columnIndex) =>
            normalizeUpdatedCellValue(row[columnIndex] ?? "", column.dataType),
          ),
        );

  const existingSignatures = await getExistingRowSignatures(
    params.normalizedDepartmentTableName,
    params.editableColumns,
  );

  return toImportPreviewRows(normalizedRows, params.editableColumns, existingSignatures);
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
  const user = c.get("user");
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

  await ensureSystemTableColumns({
    tableName: normalizedDepartmentTableName,
    departmentId: department.id,
    createdByUserId: user?.id ?? null,
  });

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
    `SELECT * FROM ${quotedTableName} ${whereClause} ORDER BY ${quoteIdentifier("updated_at")} DESC, "id" ASC LIMIT ${pageSize} OFFSET ${offset}`,
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
  const user = c.get("user");
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

  await ensureSystemTableColumns({
    tableName: normalizedDepartmentTableName,
    departmentId: department.id,
    createdByUserId: user?.id ?? null,
  });

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
    `UPDATE ${quotedTableName} SET ${setClause}, ${quoteIdentifier("updated_at")} = NOW() WHERE "id" = ${toSqlLiteral(rowId)}`,
  );

  await createAuditLog({
    action: "row_update",
    actorUserId: user?.id ?? null,
    departmentId: department.id,
    tableName: normalizedDepartmentTableName,
    rowId,
    summary: `Updated row ${rowId} in ${tableName}.`,
    metadata: {
      updatedColumns: normalizedEntries.map((entry) => entry.column.columnName),
    },
  });

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
  const user = c.get("user");
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

  await ensureSystemTableColumns({
    tableName: normalizedDepartmentTableName,
    departmentId: department.id,
    createdByUserId: user?.id ?? null,
  });

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
  const editableColumns = columns.filter(
    (column) => !SYSTEM_TABLE_COLUMN_NAMES.has(column.columnName),
  );
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
    quoteIdentifier("created_at"),
    quoteIdentifier("updated_at"),
    quoteIdentifier("department_id"),
    quoteIdentifier("created_by_user_id"),
    ...editableColumns.map((column) => quoteIdentifier(column.columnName)),
  ];
  const insertValues = [
    toSqlLiteral(rowId),
    "NOW()",
    "NOW()",
    toSqlLiteral(department.id),
    toSqlLiteral(user?.id ?? null),
    ...editableColumns.map((column) => toSqlLiteral(valuesByColumn.get(column.columnName) ?? null)),
  ];

  await postgresClient.unsafe(
    `INSERT INTO ${quotedTableName} (${insertColumns.join(", ")}) VALUES (${insertValues.join(", ")})`,
  );

  await createAuditLog({
    action: "row_create",
    actorUserId: user?.id ?? null,
    departmentId: department.id,
    tableName: normalizedDepartmentTableName,
    rowId,
    summary: `Added a new row to ${tableName}.`,
    metadata: {
      columnCount: editableColumns.length,
    },
  });

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
  const user = c.get("user");
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

  await ensureSystemTableColumns({
    tableName: normalizedDepartmentTableName,
    departmentId: department.id,
    createdByUserId: user?.id ?? null,
  });

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

  await createAuditLog({
    action: "row_delete",
    actorUserId: user?.id ?? null,
    departmentId: department.id,
    tableName: normalizedDepartmentTableName,
    rowId,
    summary: `Deleted row ${rowId} from ${tableName}.`,
  });

  return c.json(
    {
      success: true,
      message: "Row deleted successfully.",
      data: null,
    },
    200,
  );
});

tableRoutes.post(
  "/api/tables/:tableName/import-image/preview",
  requireDepartmentAdmin,
  async (c) => {
    const reqLogger = c.get("logger");
    const department = c.get("department");
    const tableName = c.req.param("tableName");
    const parsedQuery = TABLE_SCAN_SOURCE_SCHEMA.safeParse(c.req.query());
    const body = await c.req.parseBody();
    const maybeFile = body.file;
    const file = Array.isArray(maybeFile) ? maybeFile[0] : maybeFile;

    if (!parsedQuery.success) {
      return c.json(
        {
          success: false,
          message: "Invalid import source.",
          data: null,
        },
        400,
      );
    }

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

    await ensureSystemTableColumns({
      tableName: normalizedDepartmentTableName,
      departmentId: department.id,
      createdByUserId: c.get("user")?.id ?? null,
    });

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

    const editableColumns = columns.filter(
      (column) => !SYSTEM_TABLE_COLUMN_NAMES.has(column.columnName),
    );
    const previewRows = await buildImageImportPreview({
      file,
      logger: reqLogger,
      source: parsedQuery.data.source,
      tableName,
      normalizedDepartmentTableName,
      editableColumns,
    });

    if (previewRows.length === 0) {
      return c.json(
        {
          success: true,
          message: "No matching table rows were found in the uploaded image.",
          data: {
            columns: editableColumns,
            rows: [],
            summary: {
              totalRows: 0,
              duplicateRows: 0,
              rowsWithMissingRequiredValues: 0,
              readyRows: 0,
            },
          },
        },
        200,
      );
    }

    return c.json(
      {
        success: true,
        message: "Import preview generated successfully.",
        data: {
          columns: editableColumns,
          rows: previewRows,
          summary: summarizePreviewRows(previewRows),
        },
      },
      200,
    );
  },
);

tableRoutes.post(
  "/api/tables/:tableName/import-image/commit",
  requireDepartmentAdmin,
  async (c) => {
    const department = c.get("department");
    const user = c.get("user");
    const tableName = c.req.param("tableName");
    const payload = await c.req.json().catch(() => null);
    const parsedPayload = IMPORT_IMAGE_COMMIT_SCHEMA.safeParse(payload);

    if (!parsedPayload.success) {
      return c.json(
        {
          success: false,
          message: "Invalid import confirmation payload.",
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

    await ensureSystemTableColumns({
      tableName: normalizedDepartmentTableName,
      departmentId: department.id,
      createdByUserId: user?.id ?? null,
    });

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

    const editableColumns = columns.filter(
      (column) => !SYSTEM_TABLE_COLUMN_NAMES.has(column.columnName),
    );
    const normalizedRows = normalizeCommittedImportRows(parsedPayload.data.rows, editableColumns);
    const rowsWithMissingRequiredValues = normalizedRows
      .filter((row) => row.missingRequiredColumns.length > 0)
      .map((row) => ({
        rowIndex: row.rowIndex,
        missingRequiredColumns: row.missingRequiredColumns,
      }));

    if (rowsWithMissingRequiredValues.length > 0) {
      return c.json(
        {
          success: false,
          message: "Required values are still missing in one or more reviewed rows.",
          data: {
            issues: rowsWithMissingRequiredValues,
          },
        },
        400,
      );
    }

    const existingSignatures = await getExistingRowSignatures(
      normalizedDepartmentTableName,
      editableColumns,
    );
    const previewRows = toImportPreviewRows(
      normalizedRows.map((row) => row.values),
      editableColumns,
      existingSignatures,
    );
    const rowsToInsert = previewRows
      .filter((row) => row.duplicateReason === null)
      .map((row) => editableColumns.map((column) => row.values[column.columnName] ?? null));

    if (rowsToInsert.length > 0) {
      await db.transaction(async (tx) => {
        await insertEditableRows({
          tableName: normalizedDepartmentTableName,
          departmentId: department.id,
          createdByUserId: user?.id ?? null,
          editableColumns,
          rows: rowsToInsert,
          tx,
        });
      });
    }

    const skippedDuplicateCount = previewRows.length - rowsToInsert.length;

    await createAuditLog({
      action: "row_import",
      actorUserId: user?.id ?? null,
      departmentId: department.id,
      tableName: normalizedDepartmentTableName,
      summary: `Imported ${rowsToInsert.length} row(s) into ${tableName}.`,
      metadata: {
        source: parsedPayload.data.source,
        reviewedRowCount: previewRows.length,
        insertedRowCount: rowsToInsert.length,
        skippedDuplicateCount,
      },
    });

    return c.json(
      {
        success: true,
        message:
          skippedDuplicateCount > 0
            ? `${rowsToInsert.length} row(s) imported. ${skippedDuplicateCount} duplicate row(s) were skipped.`
            : `${rowsToInsert.length} row(s) imported successfully.`,
        data: {
          insertedRowCount: rowsToInsert.length,
          skippedDuplicateCount,
        },
      },
      200,
    );
  },
);

tableRoutes.post("/api/tables/:tableName/import-csv", requireDepartmentAdmin, async (c) => {
  const department = c.get("department");
  const user = c.get("user");
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

  const isCsvFile =
    file.type === "text/csv" ||
    file.name.toLowerCase().endsWith(".csv") ||
    file.type === "application/vnd.ms-excel";

  if (!isCsvFile) {
    return c.json(
      {
        success: false,
        message: "Only CSV files are supported",
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

  await ensureSystemTableColumns({
    tableName: normalizedDepartmentTableName,
    departmentId: department.id,
    createdByUserId: user?.id ?? null,
  });

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

  const editableColumns = columns.filter(
    (column) => !SYSTEM_TABLE_COLUMN_NAMES.has(column.columnName),
  );
  const csvContent = await file.text();
  const parsedRows = parseCsvContent(csvContent);

  if (parsedRows.length < 2) {
    return c.json(
      {
        success: false,
        message: "CSV file must include headers and at least one row.",
        data: null,
      },
      400,
    );
  }

  const headerRow = parsedRows[0];
  const dataRows = parsedRows.slice(1);

  if (!headerRow) {
    return c.json(
      {
        success: false,
        message: "CSV file must include a header row.",
        data: null,
      },
      400,
    );
  }

  const normalizedHeaders = headerRow.map((header) => normalizeIdentifier(header));
  const expectedHeaders = editableColumns.map((column) => column.columnName);

  if (
    normalizedHeaders.length !== expectedHeaders.length ||
    normalizedHeaders.some((header, index) => header !== expectedHeaders[index])
  ) {
    return c.json(
      {
        success: false,
        message: "CSV headers must match the table columns exactly and in the same order.",
        data: {
          expectedHeaders,
        },
      },
      400,
    );
  }

  const normalizedRows = dataRows
    .map((row) =>
      editableColumns.map((column, columnIndex) =>
        normalizeUpdatedCellValue(row[columnIndex] ?? "", column.dataType),
      ),
    )
    .filter((row) => row.some((value) => value !== null));

  if (normalizedRows.length === 0) {
    return c.json(
      {
        success: false,
        message: "CSV file does not contain any non-empty rows.",
        data: null,
      },
      400,
    );
  }

  if (
    normalizedRows.some((row) =>
      editableColumns.some(
        (column, columnIndex) => !column.isNullable && row[columnIndex] === null,
      ),
    )
  ) {
    return c.json(
      {
        success: false,
        message: "Required fields are missing in one or more CSV rows.",
        data: null,
      },
      400,
    );
  }

  const existingSignatures = await getExistingRowSignatures(
    normalizedDepartmentTableName,
    editableColumns,
  );
  const previewRows = toImportPreviewRows(normalizedRows, editableColumns, existingSignatures);
  const rowsToInsert = previewRows
    .filter((row) => row.duplicateReason === null)
    .map((row) => editableColumns.map((column) => row.values[column.columnName] ?? null));
  const insertedRowCount = await insertEditableRows({
    tableName: normalizedDepartmentTableName,
    departmentId: department.id,
    createdByUserId: user?.id ?? null,
    editableColumns,
    rows: rowsToInsert,
  });
  const skippedDuplicateCount = previewRows.length - rowsToInsert.length;

  await createAuditLog({
    action: "row_import",
    actorUserId: user?.id ?? null,
    departmentId: department.id,
    tableName: normalizedDepartmentTableName,
    summary: `Imported ${insertedRowCount} CSV row(s) into ${tableName}.`,
    metadata: {
      source: "csv",
      insertedRowCount,
      skippedDuplicateCount,
    },
  });

  return c.json(
    {
      success: true,
      message:
        skippedDuplicateCount > 0
          ? `${insertedRowCount} row(s) imported from CSV. ${skippedDuplicateCount} duplicate row(s) were skipped.`
          : `${insertedRowCount} row(s) imported successfully from CSV.`,
      data: {
        insertedRowCount,
        skippedDuplicateCount,
      },
    },
    201,
  );
});

tableRoutes.post("/api/table/scan", requireDepartmentAdmin, async (c) => {
  const reqLogger = c.get("logger");
  const department = c.get("department");
  const parsedQuery = TABLE_SCAN_SOURCE_SCHEMA.safeParse(c.req.query());
  const body = await c.req.parseBody();
  const maybeFile = body.file;
  const file = Array.isArray(maybeFile) ? maybeFile[0] : maybeFile;

  if (!parsedQuery.success) {
    return c.json(
      {
        success: false,
        message: "Invalid scan source.",
        data: null,
      },
      400,
    );
  }

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

  const tables =
    parsedQuery.data.source === "paddle"
      ? await scanTableImageWithPaddle(file, reqLogger)
      : await scanTableImageWithGemini(file, reqLogger);

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
  const user = c.get("user");
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
    `${quoteIdentifier("created_at")} TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `${quoteIdentifier("updated_at")} TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `${quoteIdentifier("department_id")} TEXT NOT NULL`,
    `${quoteIdentifier("created_by_user_id")} TEXT`,
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

      await ensureSystemTableColumns({
        tableName: normalizedTableName,
        departmentId: department.id,
        createdByUserId: user?.id ?? null,
        tx,
      });

      if (parsed.data.fillData && rowsToInsert.length > 0) {
        await tx.execute(
          buildInsertRowsStatement(
            normalizedTableName,
            department.id,
            user?.id ?? null,
            normalizedColumns,
            rowsToInsert,
          ),
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

  await createAuditLog({
    action: "table_create",
    actorUserId: user?.id ?? null,
    departmentId: department.id,
    tableName: normalizedTableName,
    summary: `Created table ${normalizedBaseTableName}.`,
    metadata: {
      columnCount: normalizedColumns.length,
      insertedRowCount: parsed.data.fillData ? rowsToInsert.length : 0,
    },
  });

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
