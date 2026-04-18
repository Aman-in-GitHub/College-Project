import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { env } from "@/lib/env";

export const Route = createFileRoute("/_authenticated/")({
  component: RouteComponent,
});

const FALLBACK_COLUMN_TYPES = [
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "time",
  "timestamp",
] as const;

type DbColumnType = (typeof FALLBACK_COLUMN_TYPES)[number];

type ScannedColumn = {
  name: string;
  inferredType: DbColumnType;
  values: string[];
};

type EditableColumn = {
  name: string;
  type: DbColumnType;
};

type ScanTable = {
  columns: ScannedColumn[];
};

type ScanResponse = {
  success: boolean;
  message: string;
  data: {
    tables: ScanTable[];
    columnTypes: DbColumnType[];
  };
};

type ErrorResponse = {
  message?: string;
  data?: {
    issues?: Array<{
      path: string;
      message: string;
    }>;
  };
};

type CreateTableResponse = {
  success: boolean;
  message: string;
};

function isDbColumnType(value: string | null): value is DbColumnType {
  return value !== null && FALLBACK_COLUMN_TYPES.includes(value as DbColumnType);
}

function isScanResponse(value: unknown): value is ScanResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ScanResponse>;

  return (
    typeof candidate.success === "boolean" &&
    typeof candidate.message === "string" &&
    Boolean(candidate.data) &&
    Array.isArray(candidate.data?.tables) &&
    Array.isArray(candidate.data?.columnTypes)
  );
}

function isCreateTableResponse(value: unknown): value is CreateTableResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CreateTableResponse>;

  return typeof candidate.success === "boolean" && typeof candidate.message === "string";
}

async function scanTableRequest(file: File): Promise<ScanResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch(`${env.VITE_SERVER_URL}/api/table/scan`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  const payload: unknown = await response.json();

  if (!response.ok) {
    const errorPayload = payload as ErrorResponse;
    throw new Error(errorPayload.message ?? "Scan failed");
  }

  if (!isScanResponse(payload)) {
    throw new Error("Scan returned an invalid response");
  }

  return payload;
}

async function createTableRequest(payload: {
  tableName: string;
  columns: EditableColumn[];
}): Promise<CreateTableResponse> {
  const response = await fetch(`${env.VITE_SERVER_URL}/api/table/create`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body: unknown = await response.json();

  if (!response.ok || !isCreateTableResponse(body) || !body.success) {
    const errorBody = body as ErrorResponse;
    const issueMessage =
      errorBody.data?.issues && errorBody.data.issues.length > 0
        ? errorBody.data.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
        : null;

    throw new Error(issueMessage ?? errorBody.message ?? "Table creation failed");
  }

  return body;
}

function RouteComponent() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editableSchemas, setEditableSchemas] = useState<EditableColumn[][]>([]);
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);
  const [tableName, setTableName] = useState("");

  const scanMutation = useMutation({
    mutationFn: scanTableRequest,
    onSuccess: (payload) => {
      setEditableSchemas(
        payload.data.tables.map((table) =>
          table.columns.map((column) => ({
            name: column.name,
            type: column.inferredType,
          })),
        ),
      );
      setSelectedTableIndex(0);

      if (payload.data.tables.length > 0) {
        toast.success(payload.message || "Table scan complete.");
      } else {
        toast.error(payload.message || "No table found in the uploaded image.");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Scan failed");
    },
  });

  const createTableMutation = useMutation({
    mutationFn: createTableRequest,
    onSuccess: (payload) => {
      toast.success(payload.message || "Table created successfully.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Table creation failed");
    },
  });

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);

    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile]);

  const scanResult = scanMutation.data?.data.tables ?? [];
  const availableTypes =
    scanMutation.data && scanMutation.data.data.columnTypes.length > 0
      ? scanMutation.data.data.columnTypes
      : [...FALLBACK_COLUMN_TYPES];
  const activeTableIndex =
    scanResult.length === 0 ? 0 : Math.min(selectedTableIndex, scanResult.length - 1);

  const currentColumns = editableSchemas[activeTableIndex] ?? [];
  const currentSampleColumns = scanResult[activeTableIndex]?.columns ?? [];
  const selectedTableLabel =
    scanResult.length > 0 ? `Table ${activeTableIndex + 1}` : "Select table";

  useEffect(() => {
    if (selectedTableIndex >= scanResult.length && scanResult.length > 0) {
      setSelectedTableIndex(0);
    }
  }, [scanResult.length, selectedTableIndex]);

  function onSelectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    scanMutation.reset();
    createTableMutation.reset();
    setEditableSchemas([]);
    setSelectedTableIndex(0);
  }

  async function scanTable() {
    if (!selectedFile) {
      toast.error("Please take or upload a photo first.");
      return;
    }

    await scanMutation.mutateAsync(selectedFile);
  }

  function updateColumnName(columnIndex: number, nextName: string) {
    setEditableSchemas((previous) =>
      previous.map((tableColumns, tableIndex) => {
        if (tableIndex !== activeTableIndex) {
          return tableColumns;
        }
        return tableColumns.map((column, index) =>
          index === columnIndex ? { ...column, name: nextName } : column,
        );
      }),
    );
  }

  function updateColumnType(columnIndex: number, nextType: string | null) {
    if (!isDbColumnType(nextType)) {
      return;
    }

    setEditableSchemas((previous) =>
      previous.map((tableColumns, tableIndex) => {
        if (tableIndex !== activeTableIndex) {
          return tableColumns;
        }
        return tableColumns.map((column, index) =>
          index === columnIndex ? { ...column, type: nextType } : column,
        );
      }),
    );
  }

  async function createTable() {
    if (currentColumns.length === 0) {
      toast.error("No scanned columns to create a table from.");
      return;
    }

    if (!tableName.trim()) {
      toast.error("Please provide a table name.");
      return;
    }

    await createTableMutation.mutateAsync({
      tableName,
      columns: currentColumns,
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <h1 className="text-xl font-semibold">Scan Table From Image</h1>

      <Card>
        <CardHeader>
          <CardTitle>Photo Input</CardTitle>
          <CardDescription>Choose one method: camera or upload.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="camera-photo">Take Photo</Label>
            <Input
              id="camera-photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onSelectFile}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="upload-photo">Upload Photo</Label>
            <Input id="upload-photo" type="file" accept="image/*" onChange={onSelectFile} />
          </div>

          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Selected table preview"
              className="max-h-96 w-full object-contain"
            />
          ) : null}

          <div>
            <Button
              disabled={!selectedFile || scanMutation.isPending || createTableMutation.isPending}
              onClick={scanTable}
            >
              {scanMutation.isPending ? "Scanning..." : "Scan Table"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {scanResult.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Schema Editor</CardTitle>
            <CardDescription>
              Edit column names and types before creating the DB table.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>Detected Table</Label>
              <Select
                value={String(activeTableIndex)}
                onValueChange={(value) => setSelectedTableIndex(Number(value))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select table">{selectedTableLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {scanResult.map((_, index) => (
                    <SelectItem key={`table-${index}`} value={String(index)}>
                      Table {index + 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="table-name">Table Name</Label>
              <Input
                id="table-name"
                placeholder="example: scanned_table"
                value={tableName}
                onChange={(event) => setTableName(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-4">
              {currentColumns.map((column, index) => (
                <div key={`column-${index}`} className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="flex flex-col gap-2 md:col-span-1">
                    <Label htmlFor={`column-name-${index}`}>Column Name</Label>
                    <Input
                      id={`column-name-${index}`}
                      value={column.name}
                      onChange={(event) => updateColumnName(index, event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2 md:col-span-1">
                    <Label>Data Type</Label>
                    <Select
                      value={column.type}
                      onValueChange={(value) => updateColumnType(index, value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>{column.type}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {availableTypes.map((type) => (
                          <SelectItem key={`${index}-${type}`} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2 md:col-span-1">
                    <Label>Sample Values</Label>
                    <p className="text-sm text-muted-foreground">
                      {(currentSampleColumns[index]?.values ?? []).slice(0, 3).join(", ") ||
                        "No samples"}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <Button
                disabled={
                  scanMutation.isPending ||
                  createTableMutation.isPending ||
                  currentColumns.length === 0
                }
                onClick={createTable}
              >
                {createTableMutation.isPending ? "Creating..." : "Create Table"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
