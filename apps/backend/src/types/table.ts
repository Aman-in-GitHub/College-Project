export type DbColumnType =
  | "text"
  | "integer"
  | "numeric"
  | "boolean"
  | "date"
  | "time"
  | "timestamp";

export type ScannedTable = {
  columns: Array<{
    name: string;
    inferredType: DbColumnType;
    values: string[];
  }>;
};
