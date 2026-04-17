import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AppEnv } from "@/types/index.ts";

import { db } from "@/db";
import { env } from "@/lib/env";
import {
  DB_COLUMN_TYPES,
  mapFastApiType,
  normalizeIdentifier,
  PG_TYPE_BY_DB_TYPE,
  quoteIdentifier,
} from "@/lib/utils";
import { requireAuth } from "@/middlewares/auth.ts";

const TABLE_SCAN_RESPONSE_SCHEMA = z.object({
  success: z.boolean(),
  data: z.object({
    tables: z.array(
      z.object({
        columns: z.array(
          z.object({
            column: z.string(),
            pg_type: z.string(),
            values: z.array(z.string()),
          }),
        ),
      }),
    ),
  }),
});

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
});

export const routes = new Hono<AppEnv>();

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

  const formData = new FormData();
  formData.append("file", file, file.name);

  const fastApiResponse = await fetch(`${env.FASTAPI_URL}/api/scan-table`, {
    method: "POST",
    body: formData,
  });

  reqLogger.info(
    {
      route: "/api/table/scan",
      fastApiStatus: fastApiResponse.status,
      fastApiOk: fastApiResponse.ok,
    },
    "FastAPI scan response received",
  );

  if (!fastApiResponse.ok) {
    const errorBody = await fastApiResponse.text();
    throw new HTTPException(502, {
      message: `FastAPI scan failed (${fastApiResponse.status}): ${errorBody || "Unknown error"}`,
    });
  }

  const fastApiJson = await fastApiResponse.json();
  const parsed = TABLE_SCAN_RESPONSE_SCHEMA.safeParse(fastApiJson);

  if (!parsed.success) {
    throw new HTTPException(502, {
      message: "FastAPI returned an invalid response shape",
    });
  }

  const tables = parsed.data.data.tables.map((table) => ({
    columns: table.columns.map((column) => ({
      name: column.column,
      inferredType: mapFastApiType(column.pg_type),
      values: column.values,
    })),
  }));

  reqLogger.info(
    {
      route: "/api/table/scan",
      detectedTableCount: tables.length,
      detectedColumnCount: tables.reduce((total, table) => total + table.columns.length, 0),
    },
    "Parsed scan result",
  );

  return c.json(
    {
      success: true,
      message: "Table scan complete",
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
    return c.json(
      {
        success: false,
        message: "Invalid tableName. Use letters, numbers, underscores, and start with a letter.",
        data: null,
      },
      400,
    );
  }

  const normalizedColumns = parsed.data.columns.map((column) => ({
    ...column,
    normalizedName: normalizeIdentifier(column.name),
  }));

  if (normalizedColumns.some((column) => !column.normalizedName)) {
    return c.json(
      {
        success: false,
        message: "One or more column names are invalid",
        data: null,
      },
      400,
    );
  }

  const duplicateColumn = normalizedColumns.find(
    (column, index) =>
      normalizedColumns.findIndex(
        (candidate) => candidate.normalizedName === column.normalizedName,
      ) !== index,
  );

  if (duplicateColumn) {
    return c.json(
      {
        success: false,
        message: `Duplicate column name detected: ${duplicateColumn.name}`,
        data: null,
      },
      400,
    );
  }

  const columnDefinitions = normalizedColumns.map((column) => {
    const sqlType = PG_TYPE_BY_DB_TYPE[column.type];
    return `${quoteIdentifier(column.normalizedName as string)} ${sqlType}`;
  });

  const createTableStatement = `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(
    normalizedTableName,
  )} (${columnDefinitions.join(", ")});`;

  await db.execute(sql.raw(createTableStatement));

  reqLogger.info(
    {
      route: "/api/table/create",
      tableName: normalizedTableName,
      columnCount: normalizedColumns.length,
    },
    "Table created",
  );

  return c.json(
    {
      success: true,
      message: "Table created successfully",
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
