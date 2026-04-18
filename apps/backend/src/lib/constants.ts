// Maximum requests allowed during one global rate-limit window.
export const GLOBAL_RATE_LIMIT_MAX = 1000;
// Global rate-limit window length in milliseconds.
export const GLOBAL_RATE_LIMIT_WINDOW = 60_000;
// Redis prefix for stored rate-limit counters.
export const REDIS_RATE_LIMIT_PREFIX = "college_project_rate_limit:";
// The model to use for table scanning with Gemini.
export const GEMINI_TABLE_SCAN_MODEL = "gemini-2.5-flash";

export const DB_COLUMN_TYPES = [
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "time",
  "timestamp",
] as const;

export const PG_TYPE_BY_DB_TYPE: Record<(typeof DB_COLUMN_TYPES)[number], string> = {
  text: "TEXT",
  integer: "INTEGER",
  numeric: "NUMERIC",
  boolean: "BOOLEAN",
  date: "DATE",
  time: "TIME",
  timestamp: "TIMESTAMP",
};

export const DEPARTMENT_ROLE_PRIORITY = {
  department_staff: 0,
  department_admin: 1,
} as const;
