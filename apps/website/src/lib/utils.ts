import { clsx, type ClassValue } from "clsx";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";
import * as XLSX from "xlsx";

import { EXPORT_FILE_FORMATS } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function fetchApiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    credentials: init?.credentials ?? "include",
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {
      response,
      body: null,
    };
  }

  const body = await response.json().catch(() => null);

  return {
    response,
    body,
  };
}

export type ExportFileFormat = (typeof EXPORT_FILE_FORMATS)[number];

export function showErrorToast(message: string, description?: string) {
  toast.error(message, {
    description,
  });
}

export function showInfoToast(message: string, description?: string) {
  toast.info(message, {
    description,
  });
}

export function showSuccessToast(message: string, description?: string) {
  toast.success(message, {
    description,
  });
}

export function showWarningToast(message: string, description?: string) {
  toast.warning(message, {
    description,
  });
}

export function buildExportFilename(params: {
  baseName: string;
  suffix: string;
  format: ExportFileFormat;
}): string {
  return `${params.baseName}_${params.suffix}.${params.format}`;
}

export function exportRecordsFile(params: {
  rows: Array<Record<string, unknown>>;
  headers?: string[];
  sheetName: string;
  filename: string;
  format: ExportFileFormat;
}): void {
  if (params.format === "json") {
    const jsonBlob = new Blob([JSON.stringify(params.rows, null, 2)], {
      type: "application/json;charset=utf-8;",
    });
    const url = URL.createObjectURL(jsonBlob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = params.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(params.rows, {
    header: params.headers,
  });
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, params.sheetName);
  XLSX.writeFile(workbook, params.filename, {
    bookType: params.format,
  });
}
