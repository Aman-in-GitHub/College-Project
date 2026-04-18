import type { Logger } from "pino";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";

import type { ScannedTable } from "@/types/table.ts";

import { GEMINI_TABLE_SCAN_MODEL } from "@/lib/constants";
import { env } from "@/lib/env";
import { normalizeIdentifier } from "@/lib/utils";
const dbColumnTypeSchema = z.enum([
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "time",
  "timestamp",
]);

const extractedColumnSchema = z.object({
  column: z
    .string()
    .describe(
      "The visible header text for this column. Use an empty string when the header is missing.",
    ),
  inferredType: dbColumnTypeSchema.describe(
    "The best PostgreSQL type for this full column: text, integer, numeric, boolean, date, time, or timestamp.",
  ),
  values: z
    .array(
      z
        .string()
        .describe(
          "The cell text for one row in this column. Use an empty string for blank or unreadable cells.",
        ),
    )
    .describe("All cell values in this column, in top-to-bottom row order."),
});

const extractedTableSchema = z.object({
  columns: z
    .array(extractedColumnSchema)
    .describe("All columns in the table, preserving the exact left-to-right order."),
});

const extractedTablesSchema = z.object({
  tables: z
    .array(extractedTableSchema)
    .describe(
      "Every visible table in the image, returned in reading order. Return an empty array when no table is present.",
    ),
});

const extractedRowValuesSchema = z.object({
  values: z
    .array(
      z
        .string()
        .describe(
          "One cell value in the exact column order provided. Use an empty string for blank cells.",
        ),
    )
    .describe("Cell values for a single row, following the exact provided column order."),
});

const extractedExistingTableRowsSchema = z.object({
  rows: z
    .array(extractedRowValuesSchema)
    .describe(
      "Rows extracted for the existing table schema only, preserving the top-to-bottom order from the image.",
    ),
});

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY,
});

function normalizeHeader(name: string, index: number): string {
  const baseName = name.trim();

  if (!baseName) {
    return `column_${index + 1}`;
  }

  const normalizedName = baseName
    .replace(/\s+/g, "_")
    .replace(/\W+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  if (!normalizedName) {
    return `column_${index + 1}`;
  }

  const postgresSafeName = normalizeIdentifier(normalizedName);

  if (postgresSafeName) {
    return postgresSafeName;
  }

  const prefixedName = normalizeIdentifier(`column_${normalizedName}`);

  return prefixedName || `column_${index + 1}`;
}

function toScannedTables(tables: z.infer<typeof extractedTablesSchema>["tables"]): ScannedTable[] {
  return tables
    .map((table) => ({
      columns: table.columns.map((column, index) => {
        return {
          name: normalizeHeader(column.column, index),
          inferredType: column.inferredType,
          values: column.values.map((value) => value.trim()),
        };
      }),
    }))
    .filter((table) => table.columns.length > 0);
}

export async function scanTableImageWithGemini(
  file: File,
  logger: Logger,
): Promise<ScannedTable[]> {
  const imageBytes = new Uint8Array(await file.arrayBuffer());

  const { output, usage, warnings } = await generateText({
    model: google(GEMINI_TABLE_SCAN_MODEL),
    output: Output.object({
      name: "table_scan_result",
      description: "Structured extraction of all visible tables in an uploaded image.",
      schema: extractedTablesSchema,
    }),
    providerOptions: {
      google: {
        structuredOutputs: true,
      },
    },
    system: [
      "You extract structured tabular data from a single uploaded image.",
      "This output will be used to create PostgreSQL tables.",
      "Return only content that is directly visible in the image.",
      "Do not invent rows, columns, headers, or values.",
      "Preserve table order, column order, and row order exactly.",
      "Use empty strings for blank or unreadable cells.",
      "For each column, choose the most appropriate PostgreSQL type from: text, integer, numeric, boolean, date, time, timestamp.",
      "Infer the type using the entire column, not a single cell.",
      "Numbers with thousands separators such as 8,622,357 should usually be integer if the values are whole numbers.",
      "Use numeric for decimals, currency-like decimal numbers, or mixed integer/decimal numeric columns.",
      "Use text if values are mixed, ambiguous, or include non-numeric formatting that should be preserved as text.",
      "If no table is visible, return an empty tables array.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Extract every visible table from this image.",
              "Treat this as a data-extraction task, not summarization.",
              "Keep the raw cell text as seen.",
              "Also return the best PostgreSQL type for each detected column.",
            ].join(" "),
          },
          {
            type: "file",
            mediaType: file.type || "image/png",
            data: imageBytes,
            filename: file.name || "table-image",
          },
        ],
      },
    ],
  });

  if (warnings && warnings.length > 0) {
    logger.warn({ warnings }, "Gemini table scan returned provider warnings");
  }

  logger.info(
    {
      model: GEMINI_TABLE_SCAN_MODEL,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      tableCount: output.tables.length,
      detectedColumns: output.tables.map((table, tableIndex) => ({
        table: tableIndex + 1,
        columns: table.columns.map((column) => ({
          rawName: column.column,
          inferredType: column.inferredType,
        })),
      })),
    },
    "Gemini table scan complete",
  );

  return toScannedTables(output.tables);
}

export async function scanExistingTableRowsWithGemini(params: {
  file: File;
  logger: Logger;
  tableName: string;
  columns: Array<{
    name: string;
    dataType: string;
    isNullable: boolean;
  }>;
}): Promise<string[][]> {
  const imageBytes = new Uint8Array(await params.file.arrayBuffer());
  const columnDescriptions = params.columns
    .map((column, index) => {
      return `${index + 1}. ${column.name} (${column.dataType}, ${column.isNullable ? "optional" : "required"})`;
    })
    .join("\n");

  const { output, usage, warnings } = await generateText({
    model: google(GEMINI_TABLE_SCAN_MODEL),
    output: Output.object({
      name: "existing_table_row_import",
      description: "Structured extraction of rows for an already-defined table schema.",
      schema: extractedExistingTableRowsSchema,
    }),
    providerOptions: {
      google: {
        structuredOutputs: true,
      },
    },
    system: [
      "You extract row data from a single uploaded image for an existing PostgreSQL table.",
      "Use only the provided table schema and column order.",
      "Do not add, rename, reorder, or infer new columns.",
      "Return only rows that match the provided table context.",
      "Ignore headings, summaries, notes, totals, stamps, and unrelated text outside the table rows.",
      "Use empty strings for blank or unreadable cells.",
      "Preserve row order exactly as it appears in the image.",
      "If no matching rows are visible, return an empty rows array.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Table name: ${params.tableName}`,
              "Extract rows for this existing table only.",
              "Return each row as an array of strings in this exact column order:",
              columnDescriptions,
            ].join("\n\n"),
          },
          {
            type: "file",
            mediaType: params.file.type || "image/png",
            data: imageBytes,
            filename: params.file.name || "table-image",
          },
        ],
      },
    ],
  });

  if (warnings && warnings.length > 0) {
    params.logger.warn({ warnings }, "Gemini existing-table import returned provider warnings");
  }

  params.logger.info(
    {
      model: GEMINI_TABLE_SCAN_MODEL,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      tableName: params.tableName,
      requestedColumnCount: params.columns.length,
      importedRowCount: output.rows.length,
    },
    "Gemini existing-table row import complete",
  );

  return output.rows
    .map((row) => row.values.slice(0, params.columns.length))
    .map((row) =>
      params.columns.map((_, index) => {
        return row[index]?.trim() ?? "";
      }),
    )
    .filter((row) => row.some((value) => value.length > 0));
}
