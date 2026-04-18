import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useEffectEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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
import { env } from "@/lib/env";
import { fetchApiJson, isRecord } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/$departmentSlug/$tableName")({
  component: RouteComponent,
});

const authenticatedRoute = getRouteApi("/_authenticated");

type PaginationState = {
  pageIndex: number;
  pageSize: number;
};

type TableValue = string | number | boolean | null;

type TableRowData = Record<string, TableValue>;

type TableColumn = {
  columnName: string;
  dataType: string;
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

function formatCellValue(value: TableValue): string {
  if (value === null) {
    return "";
  }

  return String(value);
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
    return <span>{formatCellValue(originalValue) || "-"}</span>;
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
}): Promise<TablePageResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.pagination.pageIndex + 1),
    pageSize: String(params.pagination.pageSize),
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

function RouteComponent() {
  const { accessContext } = authenticatedRoute.useRouteContext();
  const params = Route.useParams();
  const queryClient = useQueryClient();
  const department = accessContext.department;
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [editedRows, setEditedRows] = useState<Record<string, Record<string, string | null>>>({});
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const editedRowsRef = useRef(editedRows);
  editedRowsRef.current = editedRows;

  const tableQuery = useQuery({
    queryKey: [
      "table-page",
      params.departmentSlug,
      params.tableName,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: () =>
      fetchTablePage({
        departmentSlug: params.departmentSlug,
        tableName: params.tableName,
        pagination,
      }),
  });

  const updateRowMutation = useMutation({
    mutationFn: updateTableRow,
    onSuccess: (payload, variables) => {
      toast.success(payload.message);
      setEditedRows((previous) => {
        const next = { ...previous };
        delete next[variables.rowId];
        return next;
      });
      void queryClient.invalidateQueries({
        queryKey: ["table-page", params.departmentSlug, params.tableName],
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update row.");
    },
  });
  const addRowMutation = useMutation({
    mutationFn: addTableRow,
    onSuccess: (payload) => {
      toast.success(payload.message);
      setNewRowValues({});

      if (!payload.data.row) {
        return;
      }

      queryClient.setQueryData<TablePageResponse | undefined>(
        [
          "table-page",
          params.departmentSlug,
          params.tableName,
          pagination.pageIndex,
          pagination.pageSize,
        ],
        (previous) => {
          if (!previous) {
            return previous;
          }

          return {
            ...previous,
            data: {
              ...previous.data,
              rows: [...previous.data.rows, payload.data.row],
              pagination: {
                ...previous.data.pagination,
                totalRows: previous.data.pagination.totalRows + 1,
              },
            },
          };
        },
      );
      setEditedRows((previous) => ({
        ...previous,
        [formatCellValue(payload.data.row.id)]: {},
      }));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to add record.");
    },
  });

  const canEdit =
    accessContext.role === "department_admin" && department?.slug === params.departmentSlug;

  const tableColumns = tableQuery.data?.data.columns ?? EMPTY_TABLE_COLUMNS;
  const rows = tableQuery.data?.data.rows ?? [];
  const editableColumns = tableColumns.filter((column) => column.columnName !== "id");
  const canAddRow = editableColumns.some(
    (column) => (newRowValues[column.columnName] ?? "").trim().length > 0,
  );

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

  const columns = useMemo<ColumnDef<TableRowData>[]>(() => {
    return [
      ...tableColumns.map((column) => ({
        accessorKey: column.columnName,
        header: column.columnName,
        cell: ({ row }) => {
          const rowId = formatCellValue(row.original.id);
          return (
            <EditableTableCell
              canEdit={canEdit}
              rowId={rowId}
              columnName={column.columnName}
              originalValue={row.original[column.columnName] ?? null}
              draftValue={editedRowsRef.current[rowId]?.[column.columnName]}
              onDraftChange={handleDraftChange}
            />
          );
        },
      })),
      ...(canEdit
        ? [
            {
              id: "actions",
              header: "Actions",
              cell: ({ row }) => {
                const rowId = formatCellValue(row.original.id);
                const rowDraft = editedRowsRef.current[rowId] ?? {};
                const hasChanges = Object.keys(rowDraft).length > 0;

                return (
                  <Button
                    size="sm"
                    disabled={!hasChanges || updateRowMutation.isPending}
                    onClick={() => handleSaveRow(rowId, rowDraft)}
                  >
                    Save
                  </Button>
                );
              },
            } satisfies ColumnDef<TableRowData>,
          ]
        : []),
    ];
  }, [canEdit, tableColumns, updateRowMutation.isPending]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: tableQuery.data?.data.pagination.totalRows ?? 0,
    onPaginationChange: (updater) => {
      setPagination((previous) => (typeof updater === "function" ? updater(previous) : updater));
    },
    state: {
      pagination,
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{params.tableName}</h1>
          <p className="text-sm text-muted-foreground">
            {params.departmentSlug}
            {canEdit ? " · editable" : " · view only"}
          </p>
        </div>
        <Link to="/" className={buttonVariants({ variant: "default" })}>
          Back
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Table Data</CardTitle>
          <CardDescription>
            {canEdit
              ? "Department admins can add and update row values directly in the table."
              : "Department staff can view table data only."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
                      <TableCell colSpan={columns.length} className="text-center">
                        No rows found.
                      </TableCell>
                    </TableRow>
                  )}
                  {canEdit ? (
                    <TableRow>
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
                      <TableCell>
                        <Button
                          size="sm"
                          disabled={!canAddRow || addRowMutation.isPending}
                          onClick={handleAddRow}
                        >
                          {addRowMutation.isPending ? "Adding..." : "Add Record"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  {tableQuery.data
                    ? `${tableQuery.data.data.pagination.totalRows} total row(s)`
                    : "0 total row(s)"}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={String(pagination.pageSize)}
                    onValueChange={(value) =>
                      setPagination({
                        pageIndex: 0,
                        pageSize: Number(value),
                      })
                    }
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 50].map((pageSize) => (
                        <SelectItem key={pageSize} value={String(pageSize)}>
                          {pageSize} / page
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="text-sm text-muted-foreground">
                    Page {pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
                  </div>

                  <Button
                    variant="outline"
                    disabled={!table.getCanPreviousPage() || tableQuery.isFetching}
                    onClick={() => table.previousPage()}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
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
    </main>
  );
}
