import {
  ArrowLeftIcon,
  CameraIcon,
  DownloadSimpleIcon,
  EraserIcon,
  FileCsvIcon,
  FloppyDiskIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TableIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type PaginationState,
  useReactTable,
} from "@tanstack/react-table";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ChangeEvent } from "react";

import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EXPORT_FILE_FORMATS } from "@/lib/constants";
import { env } from "@/lib/env";
import {
  buildExportFilename,
  exportRecordsFile,
  fetchApiJson,
  getEnterAnimationProps,
  getExitAnimationProps,
  isRecord,
  showErrorToast,
  showInfoToast,
  showSuccessToast,
  showWarningToast,
  type ExportFileFormat,
} from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/$departmentSlug/$tableName")({
  component: RouteComponent,
  head: ({ params }) => ({
    meta: [
      {
        title: `${params.tableName} | College Project`,
      },
    ],
  }),
});

const authenticatedRoute = getRouteApi("/_authenticated");

type TableValue = string | number | boolean | null;

type TableRowData = {
  id: string;
} & Record<string, TableValue>;

type TableColumn = {
  columnName: string;
  dataType: string;
  isNullable: boolean;
};

const EMPTY_TABLE_COLUMNS: TableColumn[] = [];

type TablePageResponse = {
  success: boolean;
  message: string;
  data: {
    department: {
      id: string;
      name: string;
      slug: string;
    };
    tableName: string;
    fullTableName: string;
    columns: TableColumn[];
    rows: TableRowData[];
    pagination: {
      page: number;
      pageSize: number;
      totalRows: number;
    };
  };
};

type UpdateRowResponse = {
  success: boolean;
  message: string;
  data: {
    row: TableRowData | null;
  };
};

type AddRowResponse = {
  success: boolean;
  message: string;
  data: {
    row: TableRowData | null;
  };
};

type ImportRowsResponse = {
  success: boolean;
  message: string;
  data: {
    insertedRowCount: number;
    skippedDuplicateCount?: number;
  };
};

type ImportPreviewRow = {
  values: Record<string, string | null>;
  missingRequiredColumns: string[];
  duplicateReason: "existing_row" | "batch_duplicate" | null;
};

type ImportPreviewResponse = {
  success: boolean;
  message: string;
  data: {
    columns: TableColumn[];
    rows: ImportPreviewRow[];
    summary: {
      totalRows: number;
      duplicateRows: number;
      rowsWithMissingRequiredValues: number;
      readyRows: number;
    };
  };
};

type DeleteRowResponse = {
  success: boolean;
  message: string;
  data: null;
};

type ImportSource = "paddle" | "gemini";

type EditableTableCellProps = {
  canEdit: boolean;
  rowId: string;
  columnName: string;
  originalValue: TableValue;
  draftValue: string | null | undefined;
  onDraftChange: (
    rowId: string,
    columnName: string,
    nextValue: string,
    originalValue: TableValue,
  ) => void;
};

function isTableColumn(value: unknown): value is TableColumn {
  return (
    isRecord(value) && typeof value.columnName === "string" && typeof value.dataType === "string"
  );
}

function isTableRowData(value: unknown): value is TableRowData {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== "string") {
    return false;
  }

  return Object.values(value).every(
    (entry) =>
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null,
  );
}

function isTablePageResponse(value: unknown): value is TablePageResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    isRecord(value.data.department) &&
    typeof value.data.department.id === "string" &&
    typeof value.data.department.name === "string" &&
    typeof value.data.department.slug === "string" &&
    typeof value.data.tableName === "string" &&
    typeof value.data.fullTableName === "string" &&
    Array.isArray(value.data.columns) &&
    value.data.columns.every((column) => isTableColumn(column)) &&
    Array.isArray(value.data.rows) &&
    value.data.rows.every((row) => isTableRowData(row)) &&
    isRecord(value.data.pagination) &&
    typeof value.data.pagination.page === "number" &&
    typeof value.data.pagination.pageSize === "number" &&
    typeof value.data.pagination.totalRows === "number"
  );
}

function getRowValue(row: TableRowData, columnName: string): TableValue {
  return row[columnName] ?? null;
}

function isUpdateRowResponse(value: unknown): value is UpdateRowResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    (value.data.row === null || isTableRowData(value.data.row))
  );
}

function isAddRowResponse(value: unknown): value is AddRowResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    (value.data.row === null || isTableRowData(value.data.row))
  );
}

function isImportRowsResponse(value: unknown): value is ImportRowsResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    typeof value.data.insertedRowCount === "number"
  );
}

function isImportPreviewRow(value: unknown): value is ImportPreviewRow {
  return (
    isRecord(value) &&
    isRecord(value.values) &&
    Array.isArray(value.missingRequiredColumns) &&
    value.missingRequiredColumns.every((column) => typeof column === "string") &&
    (value.duplicateReason === "existing_row" ||
      value.duplicateReason === "batch_duplicate" ||
      value.duplicateReason === null)
  );
}

function isImportPreviewResponse(value: unknown): value is ImportPreviewResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    Array.isArray(value.data.columns) &&
    value.data.columns.every((column) => isTableColumn(column)) &&
    Array.isArray(value.data.rows) &&
    value.data.rows.every((row) => isImportPreviewRow(row)) &&
    isRecord(value.data.summary) &&
    typeof value.data.summary.totalRows === "number" &&
    typeof value.data.summary.duplicateRows === "number" &&
    typeof value.data.summary.rowsWithMissingRequiredValues === "number" &&
    typeof value.data.summary.readyRows === "number"
  );
}

function isDeleteRowResponse(value: unknown): value is DeleteRowResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    value.data === null
  );
}

function isExportFileFormat(value: string | null): value is ExportFileFormat {
  return value !== null && EXPORT_FILE_FORMATS.some((format) => format === value);
}

function formatCellValue(value: TableValue): string {
  if (value === null) {
    return "";
  }

  return String(value);
}

function formatTableDisplayValue(columnName: string, value: TableValue): string {
  const formattedValue = formatCellValue(value);

  if (columnName === "id" && formattedValue.length > 10) {
    return `${formattedValue.slice(0, 10)}...`;
  }

  return formattedValue;
}

function buildImportReviewSignature(
  values: Record<string, string | null>,
  columns: TableColumn[],
): string {
  return JSON.stringify(columns.map((column) => values[column.columnName] ?? null));
}

function reconcileImportPreviewRows(
  rows: ImportPreviewRow[],
  columns: TableColumn[],
): ImportPreviewRow[] {
  const existingSignatures = new Set(
    rows
      .filter((row) => row.duplicateReason === "existing_row")
      .map((row) => buildImportReviewSignature(row.values, columns)),
  );
  const batchSignatures = new Set<string>();

  return rows.map((row) => {
    const missingRequiredColumns = columns
      .filter((column) => !column.isNullable && (row.values[column.columnName] ?? null) === null)
      .map((column) => column.columnName);
    const signature = buildImportReviewSignature(row.values, columns);
    let duplicateReason: ImportPreviewRow["duplicateReason"] = null;

    if (existingSignatures.has(signature)) {
      duplicateReason = "existing_row";
    } else if (batchSignatures.has(signature)) {
      duplicateReason = "batch_duplicate";
    } else {
      batchSignatures.add(signature);
    }

    return {
      ...row,
      missingRequiredColumns,
      duplicateReason,
    };
  });
}

function summarizeImportPreviewRows(rows: ImportPreviewRow[]) {
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

function exportRowsToFile(params: {
  columns: TableColumn[];
  rows: TableRowData[];
  filename: string;
  format: ExportFileFormat;
  sheetName: string;
}): void {
  const columnNames = params.columns.map((column) => column.columnName);
  const exportRows = params.rows.map((row) => {
    return columnNames.reduce<Record<string, TableValue>>((result, columnName) => {
      result[columnName] = getRowValue(row, columnName);
      return result;
    }, {});
  });

  exportRecordsFile({
    rows: exportRows,
    headers: columnNames,
    sheetName: params.sheetName,
    filename: params.filename,
    format: params.format,
  });
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

function EditableTableCell({
  canEdit,
  rowId,
  columnName,
  originalValue,
  draftValue,
  onDraftChange,
}: EditableTableCellProps) {
  if (!canEdit || columnName === "id") {
    return <span>{formatTableDisplayValue(columnName, originalValue) || "-"}</span>;
  }

  return (
    <Input
      value={draftValue ?? formatCellValue(originalValue)}
      onChange={(event) => {
        onDraftChange(rowId, columnName, event.target.value, originalValue);
      }}
    />
  );
}

async function fetchTablePage(params: {
  departmentSlug: string;
  tableName: string;
  pagination: PaginationState;
  search: string;
}): Promise<TablePageResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.pagination.pageIndex + 1),
    pageSize: String(params.pagination.pageSize),
    search: params.search,
  });

  const { response, body } = await fetchApiJson(
    `${env.VITE_SERVER_URL}/api/tables/${encodeURIComponent(params.tableName)}?${searchParams.toString()}`,
    {
      headers: {
        "x-department-slug": params.departmentSlug,
      },
    },
  );

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    if (isRecord(body) && typeof body.error === "string") {
      throw new Error(body.error);
    }

    throw new Error("Failed to load table.");
  }

  if (!isTablePageResponse(body)) {
    throw new Error("Invalid table response.");
  }

  return body;
}

async function updateTableRow(params: {
  departmentSlug: string;
  tableName: string;
  rowId: string;
  values: Record<string, string | null>;
}): Promise<UpdateRowResponse> {
  const { response, body } = await fetchApiJson(
    `${env.VITE_SERVER_URL}/api/tables/${encodeURIComponent(params.tableName)}/rows/${encodeURIComponent(params.rowId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-department-slug": params.departmentSlug,
      },
      body: JSON.stringify({
        values: params.values,
      }),
    },
  );

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to update row.");
  }

  if (!isUpdateRowResponse(body)) {
    throw new Error("Invalid row update response.");
  }

  return body;
}

async function addTableRow(params: {
  departmentSlug: string;
  tableName: string;
  values: Record<string, string | null>;
}): Promise<AddRowResponse> {
  const { response, body } = await fetchApiJson(
    `${env.VITE_SERVER_URL}/api/tables/${encodeURIComponent(params.tableName)}/rows`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-department-slug": params.departmentSlug,
      },
      body: JSON.stringify({
        values: params.values,
      }),
    },
  );

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to add record.");
  }

  if (!isAddRowResponse(body)) {
    throw new Error("Invalid add record response.");
  }

  return body;
}

async function previewImageImport(params: {
  departmentSlug: string;
  tableName: string;
  file: File;
  source: ImportSource;
}): Promise<ImportPreviewResponse> {
  const formData = new FormData();
  formData.append("file", params.file, params.file.name);

  const { response, body } = await fetchApiJson(
    `${env.VITE_SERVER_URL}/api/tables/${encodeURIComponent(params.tableName)}/import-image/preview?source=${encodeURIComponent(params.source)}`,
    {
      method: "POST",
      headers: {
        "x-department-slug": params.departmentSlug,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to preview rows from image.");
  }

  if (!isImportPreviewResponse(body)) {
    throw new Error("Invalid import preview response.");
  }

  return body;
}

async function confirmImageImport(params: {
  departmentSlug: string;
  tableName: string;
  source: ImportSource;
  rows: ImportPreviewRow[];
}): Promise<ImportRowsResponse> {
  const { response, body } = await fetchApiJson(
    `${env.VITE_SERVER_URL}/api/tables/${encodeURIComponent(params.tableName)}/import-image/commit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-department-slug": params.departmentSlug,
      },
      body: JSON.stringify({
        source: params.source,
        rows: params.rows.map((row) => ({
          values: row.values,
        })),
      }),
    },
  );

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to confirm image import.");
  }

  if (!isImportRowsResponse(body)) {
    throw new Error("Invalid import confirmation response.");
  }

  return body;
}

async function importTableRowsFromCsv(params: {
  departmentSlug: string;
  tableName: string;
  file: File;
}): Promise<ImportRowsResponse> {
  const formData = new FormData();
  formData.append("file", params.file, params.file.name);

  const { response, body } = await fetchApiJson(
    `${env.VITE_SERVER_URL}/api/tables/${encodeURIComponent(params.tableName)}/import-csv`,
    {
      method: "POST",
      headers: {
        "x-department-slug": params.departmentSlug,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to import rows from CSV.");
  }

  if (!isImportRowsResponse(body)) {
    throw new Error("Invalid CSV import response.");
  }

  return body;
}

async function deleteTableRow(params: {
  departmentSlug: string;
  tableName: string;
  rowId: string;
}): Promise<DeleteRowResponse> {
  const { response, body } = await fetchApiJson(
    `${env.VITE_SERVER_URL}/api/tables/${encodeURIComponent(params.tableName)}/rows/${encodeURIComponent(params.rowId)}`,
    {
      method: "DELETE",
      headers: {
        "x-department-slug": params.departmentSlug,
      },
    },
  );

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to delete row.");
  }

  if (!isDeleteRowResponse(body)) {
    throw new Error("Invalid delete row response.");
  }

  return body;
}

function RouteComponent() {
  const { accessContext } = authenticatedRoute.useRouteContext();
  const params = Route.useParams();
  const isReducedMotion = useReducedMotion() === true;
  const queryClient = useQueryClient();
  const tableQueryKey = ["table-page", params.departmentSlug, params.tableName] as const;
  const department = accessContext.department;
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [editedRows, setEditedRows] = useState<Record<string, Record<string, string | null>>>({});
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [importPreviewUrl, setImportPreviewUrl] = useState<string | null>(null);
  const [importPreviewRows, setImportPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [importPreviewSource, setImportPreviewSource] = useState<ImportSource | null>(null);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFileFormat>("xlsx");
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const [activeImportSource, setActiveImportSource] = useState<ImportSource | null>(null);
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const editedRowsRef = useRef(editedRows);
  const importCameraInputRef = useRef<HTMLInputElement | null>(null);
  const importUploadInputRef = useRef<HTMLInputElement | null>(null);
  const importCsvInputRef = useRef<HTMLInputElement | null>(null);
  editedRowsRef.current = editedRows;

  useEffect(() => {
    if (!selectedImportFile) {
      setImportPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImportFile);
    setImportPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedImportFile]);

  const tableQuery = useQuery({
    queryKey: [...tableQueryKey, debouncedSearchTerm, pagination.pageIndex, pagination.pageSize],
    queryFn: () =>
      fetchTablePage({
        departmentSlug: params.departmentSlug,
        tableName: params.tableName,
        pagination,
        search: debouncedSearchTerm,
      }),
  });

  const updateRowMutation = useMutation({
    mutationFn: updateTableRow,
    onSuccess: (payload, variables) => {
      showSuccessToast(payload.message);
      setEditedRows((previous) => {
        const next = { ...previous };
        delete next[variables.rowId];
        return next;
      });
      void queryClient.invalidateQueries({
        queryKey: tableQueryKey,
      });
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Failed to update row.");
    },
  });
  const addRowMutation = useMutation({
    mutationFn: addTableRow,
    onSuccess: (payload) => {
      showSuccessToast(payload.message);
      setNewRowValues({});
      void queryClient.invalidateQueries({
        queryKey: tableQueryKey,
      });
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Failed to add record.");
    },
  });
  const importRowsMutation = useMutation({
    mutationFn: previewImageImport,
    onSuccess: (payload) => {
      setActiveImportSource(null);
      setImportPreviewRows(reconcileImportPreviewRows(payload.data.rows, payload.data.columns));
      showInfoToast(payload.message);
    },
    onError: (error) => {
      setActiveImportSource(null);
      showErrorToast(error instanceof Error ? error.message : "Failed to import rows.");
    },
  });
  const confirmImportMutation = useMutation({
    mutationFn: confirmImageImport,
    onSuccess: (payload) => {
      showSuccessToast(payload.message);
      setSelectedImportFile(null);
      setImportPreviewRows([]);
      setImportPreviewSource(null);

      if (importCameraInputRef.current) {
        importCameraInputRef.current.value = "";
      }

      if (importUploadInputRef.current) {
        importUploadInputRef.current.value = "";
      }

      if (importCsvInputRef.current) {
        importCsvInputRef.current.value = "";
      }

      void queryClient.invalidateQueries({
        queryKey: tableQueryKey,
      });
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Failed to confirm import.");
    },
  });
  const importCsvMutation = useMutation({
    mutationFn: importTableRowsFromCsv,
    onSuccess: (payload) => {
      showSuccessToast(payload.message);
      setSelectedImportFile(null);

      if (importCameraInputRef.current) {
        importCameraInputRef.current.value = "";
      }

      if (importUploadInputRef.current) {
        importUploadInputRef.current.value = "";
      }

      if (importCsvInputRef.current) {
        importCsvInputRef.current.value = "";
      }

      void queryClient.invalidateQueries({
        queryKey: tableQueryKey,
      });
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Failed to import CSV rows.");
    },
  });
  const deleteRowMutation = useMutation({
    mutationFn: deleteTableRow,
    onSuccess: (payload, variables) => {
      showSuccessToast(payload.message);
      setDeletingRowId((previous) => (previous === variables.rowId ? null : previous));
      setEditedRows((previous) => {
        const next = { ...previous };
        delete next[variables.rowId];
        return next;
      });
      void queryClient.invalidateQueries({
        queryKey: tableQueryKey,
      });
    },
    onError: (error) => {
      setDeletingRowId(null);
      showErrorToast(error instanceof Error ? error.message : "Failed to delete row.");
    },
  });

  const canEdit =
    accessContext.role === "department_admin" && department?.slug === params.departmentSlug;

  const tableColumns = tableQuery.data?.data.columns ?? EMPTY_TABLE_COLUMNS;
  const rows = tableQuery.data?.data.rows ?? [];
  const totalRows = tableQuery.data?.data.pagination.totalRows ?? 0;
  const editableColumns = tableColumns.filter((column) => column.columnName !== "id");
  const importPreviewSummary = summarizeImportPreviewRows(importPreviewRows);
  const canAddRow = editableColumns.some(
    (column) => (newRowValues[column.columnName] ?? "").trim().length > 0,
  );
  const exportFormatOptions = EXPORT_FILE_FORMATS.map((format) => ({
    value: format,
    label: format.toUpperCase(),
  }));
  const pageSizeOptions = [10, 20, 50].map((pageSize) => ({
    value: String(pageSize),
    label: `${pageSize} / page`,
  }));

  const handleDraftChange = useEffectEvent(
    (rowId: string, columnName: string, nextValue: string, originalValue: TableValue) => {
      const originalStringValue = formatCellValue(originalValue);

      setEditedRows((previous) => {
        const rowDraft = { ...previous[rowId] };

        if (nextValue === originalStringValue) {
          delete rowDraft[columnName];
        } else {
          rowDraft[columnName] = nextValue;
        }

        if (Object.keys(rowDraft).length === 0) {
          const next = { ...previous };
          delete next[rowId];
          return next;
        }

        return {
          ...previous,
          [rowId]: rowDraft,
        };
      });
    },
  );

  const handleSaveRow = useEffectEvent((rowId: string, values: Record<string, string | null>) => {
    void updateRowMutation.mutateAsync({
      departmentSlug: params.departmentSlug,
      tableName: params.tableName,
      rowId,
      values,
    });
  });

  function handleNewRowValueChange(columnName: string, nextValue: string) {
    setNewRowValues((previous) => ({
      ...previous,
      [columnName]: nextValue,
    }));
  }

  function handleAddRow() {
    const values = editableColumns.reduce<Record<string, string | null>>((result, column) => {
      result[column.columnName] = newRowValues[column.columnName] ?? "";
      return result;
    }, {});

    void addRowMutation.mutateAsync({
      departmentSlug: params.departmentSlug,
      tableName: params.tableName,
      values,
    });
  }

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;

    setSearchTerm(nextValue);
    setPagination((previous) => ({
      ...previous,
      pageIndex: 0,
    }));
  }

  function handleExportCurrentPage() {
    if (rows.length === 0) {
      showWarningToast("No rows to export.");
      return;
    }

    exportRowsToFile({
      columns: tableColumns,
      rows,
      sheetName: params.tableName,
      filename: buildExportFilename({
        baseName: `${params.departmentSlug}_${params.tableName}`,
        suffix: "page",
        format: exportFormat,
      }),
      format: exportFormat,
    });

    showInfoToast("Current page exported.");
  }

  async function handleExportAll() {
    setIsExportingAll(true);

    try {
      const exportPageSize = 100;
      const firstPage = await fetchTablePage({
        departmentSlug: params.departmentSlug,
        tableName: params.tableName,
        pagination: {
          pageIndex: 0,
          pageSize: exportPageSize,
        },
        search: debouncedSearchTerm,
      });

      const allRows = [...firstPage.data.rows];
      const totalRows = firstPage.data.pagination.totalRows;
      const totalPages = Math.max(Math.ceil(totalRows / exportPageSize), 1);

      for (let pageIndex = 1; pageIndex < totalPages; pageIndex += 1) {
        const page = await fetchTablePage({
          departmentSlug: params.departmentSlug,
          tableName: params.tableName,
          pagination: {
            pageIndex,
            pageSize: exportPageSize,
          },
          search: debouncedSearchTerm,
        });

        allRows.push(...page.data.rows);
      }

      if (allRows.length === 0) {
        showWarningToast("No rows to export.");
        return;
      }

      exportRowsToFile({
        columns: firstPage.data.columns,
        rows: allRows,
        sheetName: params.tableName,
        filename: buildExportFilename({
          baseName: `${params.departmentSlug}_${params.tableName}`,
          suffix: "all",
          format: exportFormat,
        }),
        format: exportFormat,
      });

      showInfoToast("All rows exported.");
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Failed to export all rows.");
    } finally {
      setIsExportingAll(false);
    }
  }

  function handleImportFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const inputId = event.target.id;

    setSelectedImportFile(file);
    setImportPreviewRows([]);
    setImportPreviewSource(null);

    if (inputId === "table-import-camera" && importUploadInputRef.current) {
      importUploadInputRef.current.value = "";
    }

    if (inputId === "table-import-upload" && importCameraInputRef.current) {
      importCameraInputRef.current.value = "";
    }

    if (inputId === "table-import-csv") {
      if (importCameraInputRef.current) {
        importCameraInputRef.current.value = "";
      }

      if (importUploadInputRef.current) {
        importUploadInputRef.current.value = "";
      }
    }

    if (inputId !== "table-import-csv" && importCsvInputRef.current) {
      importCsvInputRef.current.value = "";
    }
  }

  function handleClearImportSelection() {
    setSelectedImportFile(null);
    setImportPreviewRows([]);
    setImportPreviewSource(null);

    if (importCameraInputRef.current) {
      importCameraInputRef.current.value = "";
    }

    if (importUploadInputRef.current) {
      importUploadInputRef.current.value = "";
    }

    if (importCsvInputRef.current) {
      importCsvInputRef.current.value = "";
    }
  }

  function handleImportRows() {
    void handleImportRowsWithSource("paddle");
  }

  function handleImportRowsWithGemini() {
    void handleImportRowsWithSource("gemini");
  }

  async function handleImportRowsWithSource(source: ImportSource) {
    if (!selectedImportFile) {
      showWarningToast("Please take or upload a file first.");
      return;
    }

    const isCsvFile =
      selectedImportFile.type === "text/csv" ||
      selectedImportFile.type === "application/vnd.ms-excel" ||
      selectedImportFile.name.toLowerCase().endsWith(".csv");

    if (isCsvFile) {
      void importCsvMutation.mutateAsync({
        departmentSlug: params.departmentSlug,
        tableName: params.tableName,
        file: selectedImportFile,
      });

      return;
    }

    setActiveImportSource(source);
    setImportPreviewSource(source);
    await importRowsMutation.mutateAsync({
      departmentSlug: params.departmentSlug,
      tableName: params.tableName,
      file: selectedImportFile,
      source,
    });
  }

  function handleImportPreviewValueChange(rowIndex: number, columnName: string, nextValue: string) {
    setImportPreviewRows((previous) =>
      reconcileImportPreviewRows(
        previous.map((row, index) =>
          index === rowIndex
            ? {
                ...row,
                values: {
                  ...row.values,
                  [columnName]: nextValue.length > 0 ? nextValue : null,
                },
              }
            : row,
        ),
        editableColumns,
      ),
    );
  }

  function handleDeletePreviewRow(rowIndex: number) {
    setImportPreviewRows((previous) =>
      reconcileImportPreviewRows(
        previous.filter((_, index) => index !== rowIndex),
        editableColumns,
      ),
    );
  }

  function handleConfirmImport() {
    if (!importPreviewSource) {
      showWarningToast("No import preview is available.");
      return;
    }

    void confirmImportMutation.mutateAsync({
      departmentSlug: params.departmentSlug,
      tableName: params.tableName,
      source: importPreviewSource,
      rows: importPreviewRows,
    });
  }

  const handleDeleteRow = useEffectEvent((rowId: string) => {
    setDeletingRowId(rowId);
    void deleteRowMutation.mutateAsync({
      departmentSlug: params.departmentSlug,
      tableName: params.tableName,
      rowId,
    });
  });

  const columnDefs = useMemo<ColumnDef<TableRowData>[]>(() => {
    const dataColumns: ColumnDef<TableRowData>[] = tableColumns.map((column) => ({
      accessorKey: column.columnName,
      header: column.columnName,
      cell: ({ row }) => {
        return (
          <EditableTableCell
            canEdit={canEdit}
            rowId={row.original.id}
            columnName={column.columnName}
            originalValue={getRowValue(row.original, column.columnName)}
            draftValue={editedRowsRef.current[row.original.id]?.[column.columnName]}
            onDraftChange={handleDraftChange}
          />
        );
      },
    }));
    const actionColumns: ColumnDef<TableRowData>[] = canEdit
      ? [
          {
            id: "actions",
            header: "Actions",
            cell: ({ row }) => {
              const rowDraft = editedRowsRef.current[row.original.id] ?? {};
              const hasChanges = Object.keys(rowDraft).length > 0;
              const isDeletingCurrentRow = deletingRowId === row.original.id;

              return (
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    className="w-20"
                    disabled={!hasChanges || updateRowMutation.isPending || isDeletingCurrentRow}
                    onClick={() => handleSaveRow(row.original.id, rowDraft)}
                  >
                    <FloppyDiskIcon className="mb-1 size-4" weight="bold" />
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="w-20"
                    disabled={deleteRowMutation.isPending || updateRowMutation.isPending}
                    onClick={() => handleDeleteRow(row.original.id)}
                  >
                    <TrashIcon className="mb-1 size-4" weight="bold" />
                  </Button>
                </div>
              );
            },
          },
        ]
      : [];

    return [...actionColumns, ...dataColumns];
  }, [
    canEdit,
    deleteRowMutation.isPending,
    deletingRowId,
    tableColumns,
    updateRowMutation.isPending,
  ]);

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: totalRows,
    onPaginationChange: (updater) => {
      setPagination((previous) => (typeof updater === "function" ? updater(previous) : updater));
    },
    state: {
      pagination,
    },
  });

  return (
    <motion.main
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6"
      {...getEnterAnimationProps(isReducedMotion)}
    >
      <motion.div
        className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        {...getEnterAnimationProps(isReducedMotion, 0.03)}
      >
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <TableIcon className="mb-1 size-5 text-primary" weight="duotone" />
            {params.tableName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {params.departmentSlug}
            {canEdit ? " · editable" : " · view only"}
          </p>
        </div>
        <Link to="/" className={buttonVariants({ variant: "default" })}>
          <ArrowLeftIcon className="mb-1 size-4" weight="bold" />
          Back
        </Link>
      </motion.div>

      <motion.div {...getEnterAnimationProps(isReducedMotion, 0.06, 14)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TableIcon className="mb-1 size-5 text-primary" weight="duotone" />
              Table Data
            </CardTitle>
            <CardDescription>
              {canEdit
                ? "Department admins can add and update row values directly in the table."
                : "Department staff can view table data only."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-8">
            {canEdit ? (
              <div className="flex flex-col gap-4 border p-4">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-medium">Import Rows</div>
                  <div className="text-sm text-muted-foreground">
                    Upload a photo or CSV file that matches this table and add only row data.
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="table-import-camera" className="text-sm font-medium">
                      <span className="mr-2 inline-flex align-middle">
                        <CameraIcon className="mb-1 size-4 text-primary" weight="duotone" />
                      </span>
                      Take Photo
                    </label>
                    <Input
                      id="table-import-camera"
                      ref={importCameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImportFileSelect}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="table-import-upload" className="text-sm font-medium">
                      <span className="mr-2 inline-flex align-middle">
                        <UploadSimpleIcon className="mb-1 size-4 text-primary" weight="duotone" />
                      </span>
                      Upload Photo
                    </label>
                    <Input
                      id="table-import-upload"
                      ref={importUploadInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImportFileSelect}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="table-import-csv" className="text-sm font-medium">
                      <span className="mr-2 inline-flex align-middle">
                        <FileCsvIcon className="mb-1 size-4 text-primary" weight="duotone" />
                      </span>
                      Upload CSV
                    </label>
                    <Input
                      id="table-import-csv"
                      ref={importCsvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleImportFileSelect}
                    />
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {importPreviewUrl && selectedImportFile?.type.startsWith("image/") ? (
                    <motion.div
                      key="import-preview"
                      {...getExitAnimationProps(isReducedMotion, 10)}
                    >
                      <img
                        src={importPreviewUrl}
                        alt="Selected rows import preview"
                        className="max-h-80 w-full object-contain"
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    disabled={
                      !selectedImportFile ||
                      importRowsMutation.isPending ||
                      importCsvMutation.isPending
                    }
                    onClick={handleImportRows}
                  >
                    <UploadSimpleIcon className="mb-1 size-4" weight="bold" />
                    {(importRowsMutation.isPending && activeImportSource === "paddle") ||
                    importCsvMutation.isPending
                      ? "Importing..."
                      : "Import Rows"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    disabled={
                      !selectedImportFile ||
                      importRowsMutation.isPending ||
                      importCsvMutation.isPending
                    }
                    onClick={handleImportRowsWithGemini}
                  >
                    <UploadSimpleIcon className="mb-1 size-4" weight="bold" />
                    {importRowsMutation.isPending && activeImportSource === "gemini"
                      ? "Importing..."
                      : "Import With Gemini"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!selectedImportFile && !importPreviewUrl}
                    onClick={handleClearImportSelection}
                  >
                    <EraserIcon className="mb-1 size-4" weight="bold" />
                    Clear
                  </Button>
                </div>

                <AnimatePresence initial={false}>
                  {importPreviewRows.length > 0 ? (
                    <motion.div
                      key="ocr-import-review"
                      className="flex flex-col gap-4 border p-4"
                      {...getExitAnimationProps(isReducedMotion, 10)}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="text-sm font-medium">OCR Review</div>
                        <div className="text-sm text-muted-foreground">
                          Review extracted rows before saving them to the table.
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="border p-3 text-sm">
                          <div className="font-medium">{importPreviewSummary.totalRows}</div>
                          <div className="text-muted-foreground">Total rows</div>
                        </div>
                        <div className="border p-3 text-sm">
                          <div className="font-medium">{importPreviewSummary.readyRows}</div>
                          <div className="text-muted-foreground">Ready rows</div>
                        </div>
                        <div className="border p-3 text-sm">
                          <div className="font-medium">{importPreviewSummary.duplicateRows}</div>
                          <div className="text-muted-foreground">Duplicate rows</div>
                        </div>
                        <div className="border p-3 text-sm">
                          <div className="font-medium">
                            {importPreviewSummary.rowsWithMissingRequiredValues}
                          </div>
                          <div className="text-muted-foreground">Missing required values</div>
                        </div>
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Delete</TableHead>
                            <TableHead className="w-44">Status</TableHead>
                            {editableColumns.map((column) => (
                              <TableHead key={`import-preview-head-${column.columnName}`}>
                                {column.columnName}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importPreviewRows.map((row, rowIndex) => (
                            <TableRow key={`import-preview-row-${rowIndex}`}>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleDeletePreviewRow(rowIndex)}
                                >
                                  <TrashIcon className="mb-0.5 size-4" weight="bold" />
                                </Button>
                              </TableCell>
                              <TableCell className="text-sm">
                                {row.duplicateReason === "existing_row" ? (
                                  <span className="text-destructive">Matches existing row</span>
                                ) : row.duplicateReason === "batch_duplicate" ? (
                                  <span className="text-destructive">Duplicate in this import</span>
                                ) : row.missingRequiredColumns.length > 0 ? (
                                  <span className="text-red-500">
                                    Missing: {row.missingRequiredColumns.join(", ")}
                                  </span>
                                ) : (
                                  <span className="text-green-500">Ready</span>
                                )}
                              </TableCell>
                              {editableColumns.map((column) => (
                                <TableCell
                                  key={`import-preview-cell-${rowIndex}-${column.columnName}`}
                                >
                                  <Input
                                    value={row.values[column.columnName] ?? ""}
                                    onChange={(event) =>
                                      handleImportPreviewValueChange(
                                        rowIndex,
                                        column.columnName,
                                        event.target.value,
                                      )
                                    }
                                    placeholder={column.columnName}
                                  />
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>

                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button
                          type="button"
                          className="w-full sm:w-auto"
                          disabled={
                            confirmImportMutation.isPending || importPreviewRows.length === 0
                          }
                          onClick={handleConfirmImport}
                        >
                          <FloppyDiskIcon className="mb-1 size-4" weight="bold" />
                          {confirmImportMutation.isPending ? "Saving..." : "Confirm Import"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full sm:w-auto"
                          disabled={confirmImportMutation.isPending}
                          onClick={handleClearImportSelection}
                        >
                          <EraserIcon className="mb-1 size-4" weight="bold" />
                          Discard Preview
                        </Button>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <label htmlFor="table-search" className="text-sm font-medium">
                <span className="mr-2 inline-flex align-middle">
                  <MagnifyingGlassIcon className="mb-1 size-4 text-primary" weight="duotone" />
                </span>
                Search
              </label>
              <Input
                id="table-search"
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder="Search across the whole table"
              />
            </div>

            {tableQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading table...</p>
            ) : tableQuery.isError ? (
              <p className="text-sm text-destructive">
                {tableQuery.error instanceof Error
                  ? tableQuery.error.message
                  : "Failed to load table."}
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id}>
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.length > 0 ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={columnDefs.length} className="text-center">
                          No rows found.
                        </TableCell>
                      </TableRow>
                    )}
                    {canEdit ? (
                      <TableRow>
                        <TableCell>
                          <Button
                            size="sm"
                            className="w-20"
                            disabled={!canAddRow || addRowMutation.isPending}
                            onClick={handleAddRow}
                          >
                            <PlusIcon className="mb-1 size-4" weight="bold" />
                            {addRowMutation.isPending ? "Adding..." : "Add"}
                          </Button>
                        </TableCell>
                        {tableColumns.map((column) => (
                          <TableCell key={`new-row-${column.columnName}`}>
                            {column.columnName === "id" ? (
                              <span className="text-muted-foreground">Auto</span>
                            ) : (
                              <Input
                                value={newRowValues[column.columnName] ?? ""}
                                onChange={(event) =>
                                  handleNewRowValueChange(column.columnName, event.target.value)
                                }
                                placeholder={column.columnName}
                              />
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>

                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="grid gap-3 lg:flex lg:items-center lg:gap-3">
                    <div className="w-full lg:w-[140px]">
                      <Select
                        items={exportFormatOptions}
                        value={exportFormat}
                        onValueChange={(value) => {
                          if (isExportFileFormat(value)) {
                            setExportFormat(value);
                          }
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {exportFormatOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={rows.length === 0 || tableQuery.isLoading}
                      onClick={handleExportCurrentPage}
                    >
                      <DownloadSimpleIcon className="mb-1 size-4" weight="bold" />
                      Export Current Page
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={tableQuery.isLoading || isExportingAll}
                      onClick={() => void handleExportAll()}
                    >
                      <DownloadSimpleIcon className="mb-1 size-4" weight="bold" />
                      {isExportingAll ? "Exporting..." : "Export Full Table"}
                    </Button>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
                    <div className="text-sm text-muted-foreground sm:mr-1">
                      {`${totalRows} total row(s)`}
                    </div>
                    <Select
                      items={pageSizeOptions}
                      value={String(pagination.pageSize)}
                      onValueChange={(value) =>
                        setPagination({
                          pageIndex: 0,
                          pageSize: Number(value),
                        })
                      }
                    >
                      <SelectTrigger className="w-full sm:w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {pageSizeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="text-sm text-muted-foreground">
                      Page {pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
                    </div>

                    <Button
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={!table.getCanPreviousPage() || tableQuery.isFetching}
                      onClick={() => table.previousPage()}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={!table.getCanNextPage() || tableQuery.isFetching}
                      onClick={() => table.nextPage()}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.main>
  );
}
