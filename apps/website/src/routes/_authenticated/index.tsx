import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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

function RouteComponent() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanTable[]>([]);
  const [editableSchemas, setEditableSchemas] = useState<EditableColumn[][]>([]);
  const [availableTypes, setAvailableTypes] = useState<DbColumnType[]>([...FALLBACK_COLUMN_TYPES]);
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);
  const [tableName, setTableName] = useState("");
  const [loading, setLoading] = useState<"idle" | "scanning" | "creating">("idle");

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

  const currentColumns = useMemo(() => {
    return editableSchemas[selectedTableIndex] ?? [];
  }, [editableSchemas, selectedTableIndex]);

  const currentSampleColumns = useMemo(() => {
    return scanResult[selectedTableIndex]?.columns ?? [];
  }, [scanResult, selectedTableIndex]);

  const onSelectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  const scanTable = async () => {
    if (!selectedFile) {
      toast.error("Please take or upload a photo first.");
      return;
    }

    setLoading("scanning");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile, selectedFile.name);

      const response = await fetch(`${env.VITE_SERVER_URL}/api/table/scan`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const payload = (await response.json()) as ScanResponse | { message?: string };

      if (!response.ok) {
        throw new Error(payload.message ?? "Scan failed");
      }

      const tables = (payload as ScanResponse).data.tables;
      const columnTypes = (payload as ScanResponse).data.columnTypes;

      setScanResult(tables);
      setEditableSchemas(
        tables.map((table) =>
          table.columns.map((column) => ({
            name: column.name,
            type: column.inferredType,
          })),
        ),
      );
      setAvailableTypes(columnTypes.length > 0 ? columnTypes : [...FALLBACK_COLUMN_TYPES]);
      setSelectedTableIndex(0);
      if (tables.length > 0) {
        toast.success("Table scan complete.");
      } else {
        toast.error("No table found in the uploaded image.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scan failed");
    } finally {
      setLoading("idle");
    }
  };

  const updateColumnName = (columnIndex: number, nextName: string) => {
    setEditableSchemas((previous) =>
      previous.map((tableColumns, tableIndex) => {
        if (tableIndex !== selectedTableIndex) {
          return tableColumns;
        }
        return tableColumns.map((column, index) =>
          index === columnIndex ? { ...column, name: nextName } : column,
        );
      }),
    );
  };

  const updateColumnType = (columnIndex: number, nextType: string) => {
    setEditableSchemas((previous) =>
      previous.map((tableColumns, tableIndex) => {
        if (tableIndex !== selectedTableIndex) {
          return tableColumns;
        }
        return tableColumns.map((column, index) =>
          index === columnIndex ? { ...column, type: nextType as DbColumnType } : column,
        );
      }),
    );
  };

  const createTable = async () => {
    if (currentColumns.length === 0) {
      toast.error("No scanned columns to create a table from.");
      return;
    }

    if (!tableName.trim()) {
      toast.error("Please provide a table name.");
      return;
    }

    setLoading("creating");

    try {
      const response = await fetch(`${env.VITE_SERVER_URL}/api/table/create`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tableName,
          columns: currentColumns,
        }),
      });

      const payload = (await response.json()) as { success: boolean; message: string };

      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Table creation failed");
      }

      toast.success(payload.message ?? "Table created successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Table creation failed");
    } finally {
      setLoading("idle");
    }
  };

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
            <Button disabled={!selectedFile || loading !== "idle"} onClick={scanTable}>
              {loading === "scanning" ? "Scanning..." : "Scan Table"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {scanResult.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Schema Editor</CardTitle>
            <CardDescription>
              Edit OCR column names and types before creating the DB table.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>Detected Table</Label>
              <Select
                value={String(selectedTableIndex)}
                onValueChange={(value) => setSelectedTableIndex(Number(value))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select table" />
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
                placeholder="example: scanned_invoice"
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
                        <SelectValue />
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
                disabled={loading !== "idle" || currentColumns.length === 0}
                onClick={createTable}
              >
                {loading === "creating" ? "Creating..." : "Create Table"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
