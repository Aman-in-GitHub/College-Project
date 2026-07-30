export const FALLBACK_COLUMN_TYPES = [
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "time",
  "timestamp",
] as const;

export const EXPORT_FILE_FORMATS = ["xlsx", "csv", "json"] as const;

export type OcrLanguage = "english" | "nepali";

export const OCR_LANGUAGE_OPTIONS: Array<{ value: OcrLanguage; label: string }> = [
  { value: "english", label: "English" },
  { value: "nepali", label: "Nepali" },
];

export const SCROLL_DELAY_MS = 500;
