import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { AppEnv } from "@/types/index.ts";

import { db } from "@/db";
import { scanTableImageWithGemini } from "@/lib/table-scan";
import {
  DB_COLUMN_TYPES,
  getIdentifierValidationMessage,
  normalizeIdentifier,
  PG_TYPE_BY_DB_TYPE,
  quoteIdentifier,
} from "@/lib/utils";
import { requireAuth } from "@/middlewares/auth.ts";

const CREATE_TABLE_REQUEST_SCHEMA = z.object({
  tableName: z.string().min(1).max(63),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(63),
        type: z.enum(DB_COLUMN_TYPES),
      }),
    )
    .min(1)
    .max(200),
  fillData: z.boolean().default(false),
  rows: z.array(z.array(z.string())).default([]),
});

export const routes = new Hono<AppEnv>();

type NormalizedColumn = {
  name: string;
  normalizedName: string;
  type: (typeof DB_COLUMN_TYPES)[number];
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

routes.post("/api/table/scan", requireAuth, async (c) => {
  const reqLogger = c.get("logger");
  const body = await c.req.parseBody();
  const maybeFile = body.file;
  const file = Array.isArray(maybeFile) ? maybeFile[0] : maybeFile;

  reqLogger.info(
    {
      route: "/api/table/scan",
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
        tables,
        columnTypes: DB_COLUMN_TYPES,
      },
    },
    200,
  );
});

routes.post("/api/table/create", requireAuth, async (c) => {
  const reqLogger = c.get("logger");
  const payload = await c.req.json().catch(() => null);
  const parsed = CREATE_TABLE_REQUEST_SCHEMA.safeParse(payload);

  reqLogger.info(
    {
      route: "/api/table/create",
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

  const normalizedTableName = normalizeIdentifier(parsed.data.tableName);

  if (!normalizedTableName) {
    reqLogger.warn(
      {
        route: "/api/table/create",
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
      return `${quoteIdentifier(column.normalizedName)} ${sqlType}`;
    }),
  ];

  const createTableStatement = `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(
    normalizedTableName,
  )} (${columnDefinitions.join(", ")});`;

  const rowsToInsert = parsed.data.rows
    .map((row) => normalizedColumns.map((_, columnIndex) => row[columnIndex] ?? ""))
    .filter((row) => row.some((value) => value.trim().length > 0));

  reqLogger.info(
    {
      route: "/api/table/create",
      normalizedTableName,
      normalizedColumns: normalizedColumns.map((column) => ({
        originalName: column.name,
        normalizedName: column.normalizedName,
        type: column.type,
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
        tableName: normalizedTableName,
        columns: normalizedColumns.map((column) => ({
          name: column.normalizedName,
          type: column.type,
        })),
      },
    },
    201,
  );
});
