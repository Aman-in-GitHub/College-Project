import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  EyeIcon,
  FunnelSimpleIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { type PaginationState } from "@tanstack/react-table";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState, type ChangeEvent } from "react";

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
  cn,
  exportRecordsFile,
  fetchApiJson,
  getEnterAnimationProps,
  isRecord,
  showInfoToast,
  useDebouncedValue,
  type ExportFileFormat,
} from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/logs")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: "Logs | College Project",
      },
    ],
  }),
});

const authenticatedRoute = getRouteApi("/_authenticated");
const pageSizeOptions = [10, 20, 50].map((pageSize) => ({
  value: String(pageSize),
  label: `${pageSize} / page`,
}));
const auditActionOptions = [
  { value: "all", label: "All actions" },
  { value: "table_create", label: "Table created" },
  { value: "row_import", label: "Rows imported" },
  { value: "row_create", label: "Row created" },
  { value: "row_update", label: "Row updated" },
  { value: "row_delete", label: "Row deleted" },
  { value: "user.logged_in", label: "User logged in" },
  { value: "user.logged_out", label: "User logged out" },
  { value: "user.create", label: "User create denied" },
  { value: "user.created", label: "User created" },
  { value: "user.ban", label: "User ban denied" },
  { value: "user.banned", label: "User banned" },
  { value: "user.unban", label: "User unban denied" },
  { value: "user.unbanned", label: "User unbanned" },
  { value: "session.revoked", label: "Session revoked" },
  { value: "membership.created", label: "Member added" },
  { value: "department.created", label: "Department created" },
];
const auditCategoryOptions = [
  { value: "all", label: "All categories" },
  { value: "access_control", label: "Access control" },
  { value: "auth_security", label: "Auth security" },
  { value: "data", label: "Data" },
  { value: "import_export", label: "Import/export" },
  { value: "user_management", label: "User management" },
];
const auditStatusOptions = [
  { value: "all", label: "All outcomes" },
  { value: "success", label: "Success" },
  { value: "denied", label: "Denied" },
  { value: "failed", label: "Failed" },
];
const auditTargetTypeOptions = [
  { value: "all", label: "All targets" },
  { value: "auth", label: "Auth" },
  { value: "department", label: "Department" },
  { value: "membership", label: "Membership" },
  { value: "table", label: "Table" },
  { value: "user", label: "User" },
];
const exportFormatOptions = EXPORT_FILE_FORMATS.map((format) => ({
  value: format,
  label: format.toUpperCase(),
}));

type AuditActor = {
  id: string;
  name: string;
  email: string;
};

type AuditDepartment = {
  id: string;
  name: string;
  slug: string;
};

type AuditLogItem = {
  id: string;
  action: string;
  category: string;
  status: string;
  summary: string;
  tableName: string | null;
  rowId: string | null;
  targetType: string | null;
  targetId: string | null;
  targetUserId: string | null;
  targetDepartmentId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: AuditActor | null;
  department: AuditDepartment | null;
};

type LogsResponse = {
  success: boolean;
  message: string;
  data: {
    items: AuditLogItem[];
    pagination: {
      page: number;
      pageSize: number;
      totalRows: number;
    };
  };
};

type LogsFilters = {
  search: string;
  action: string;
  category: string;
  status: string;
  targetType: string;
  dateFrom: string;
  dateTo: string;
};

function isAuditActor(value: unknown): value is AuditActor {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string"
  );
}

function isAuditDepartment(value: unknown): value is AuditDepartment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.slug === "string"
  );
}

function isNullableRecord(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isAuditLogItem(value: unknown): value is AuditLogItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.action === "string" &&
    typeof value.category === "string" &&
    typeof value.status === "string" &&
    typeof value.summary === "string" &&
    isNullableString(value.tableName) &&
    isNullableString(value.rowId) &&
    isNullableString(value.targetType) &&
    isNullableString(value.targetId) &&
    isNullableString(value.targetUserId) &&
    isNullableString(value.targetDepartmentId) &&
    isNullableString(value.ipAddress) &&
    isNullableString(value.userAgent) &&
    isNullableString(value.requestId) &&
    isNullableRecord(value.changes) &&
    isNullableRecord(value.metadata) &&
    typeof value.createdAt === "string" &&
    (value.actor === null || isAuditActor(value.actor)) &&
    (value.department === null || isAuditDepartment(value.department))
  );
}

function isLogsResponse(value: unknown): value is LogsResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    Array.isArray(value.data.items) &&
    value.data.items.every((item) => isAuditLogItem(item)) &&
    isRecord(value.data.pagination) &&
    typeof value.data.pagination.page === "number" &&
    typeof value.data.pagination.pageSize === "number" &&
    typeof value.data.pagination.totalRows === "number"
  );
}

function isExportFileFormat(value: string | null): value is ExportFileFormat {
  return value !== null && EXPORT_FILE_FORMATS.some((format) => format === value);
}

function getAuditStatusClassName(status: string): string {
  if (status === "success") {
    return "bg-primary/10 text-primary ring-primary/20";
  }

  if (status === "denied") {
    return "bg-destructive/10 text-destructive ring-destructive/20";
  }

  if (status === "failed") {
    return "bg-muted text-foreground ring-border";
  }

  return "bg-muted text-muted-foreground ring-border";
}

function getAuditActionClassName(action: string): string {
  if (action.includes("unban") || action.includes("update")) {
    return "text-blue-500";
  }

  if (action.includes("delete") || action.includes("ban") || action.includes("revoked")) {
    return "text-red-500";
  }

  if (action.includes("logged_out")) {
    return "text-amber-500";
  }

  if (action.includes("membership")) {
    return "text-teal-500";
  }

  if (action.includes("department")) {
    return "text-cyan-500";
  }

  if (action.includes("logged_in") || action.includes("create") || action.includes("import")) {
    return "text-green-500";
  }

  if (action.includes("row")) {
    return "text-blue-500";
  }

  return "text-muted-foreground";
}

function formatAuditDate(value: string): string {
  return new Date(value).toLocaleString();
}

function formatOptionalValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "-";
}

function formatUnknownValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value.trim() || "-";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

function formatJsonBlock(value: Record<string, unknown> | null): string {
  if (value === null || Object.keys(value).length === 0) {
    return "-";
  }

  return JSON.stringify(value, null, 2);
}

function getLocalDateBoundaryIso(value: string, boundary: "start" | "end"): string {
  if (!value) {
    return "";
  }

  const date =
    boundary === "start" ? new Date(`${value}T00:00:00`) : new Date(`${value}T23:59:59.999`);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function getActorLabel(item: AuditLogItem): string {
  return item.actor ? `${item.actor.name} (${item.actor.email})` : "-";
}

function getDepartmentLabel(item: AuditLogItem): string {
  return item.department ? `${item.department.name} (${item.department.slug})` : "-";
}

function getTargetLabel(targetType: string | null): string {
  if (targetType === "session" || targetType === "auth") {
    return "auth";
  }

  if (targetType === "table_row" || targetType === "table") {
    return "table";
  }

  return formatOptionalValue(targetType);
}

function getAuditChangeRows(changes: Record<string, unknown> | null) {
  if (changes === null) {
    return [];
  }

  return Object.entries(changes).map(([field, value]) => {
    if (isRecord(value) && "from" in value && "to" in value) {
      return {
        field,
        from: formatUnknownValue(value.from),
        to: formatUnknownValue(value.to),
      };
    }

    if (isRecord(value) && "old" in value && "new" in value) {
      return {
        field,
        from: formatUnknownValue(value.old),
        to: formatUnknownValue(value.new),
      };
    }

    return {
      field,
      from: "-",
      to: formatUnknownValue(value),
    };
  });
}

function toExportRows(items: AuditLogItem[]) {
  return items.map((item) => ({
    createdAt: item.createdAt,
    action: item.action,
    category: item.category,
    status: item.status,
    summary: item.summary,
    actor: getActorLabel(item),
    department: getDepartmentLabel(item),
    tableName: item.tableName ?? "",
    rowId: item.rowId ?? "",
    targetType: item.targetType ?? "",
    targetId: item.targetId ?? "",
    ipAddress: item.ipAddress ?? "",
    requestId: item.requestId ?? "",
    changes: formatJsonBlock(item.changes),
    metadata: formatJsonBlock(item.metadata),
  }));
}

function appendQueryParam(searchParams: URLSearchParams, key: string, value: string): void {
  if (!value) {
    return;
  }

  searchParams.set(key, value);
}

async function fetchLogs(
  params: LogsFilters & { page: number; pageSize: number },
): Promise<LogsResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });

  appendQueryParam(searchParams, "search", params.search);
  appendQueryParam(searchParams, "action", params.action);
  appendQueryParam(searchParams, "category", params.category);
  appendQueryParam(searchParams, "status", params.status);
  appendQueryParam(searchParams, "targetType", params.targetType);
  appendQueryParam(searchParams, "dateFrom", getLocalDateBoundaryIso(params.dateFrom, "start"));
  appendQueryParam(searchParams, "dateTo", getLocalDateBoundaryIso(params.dateTo, "end"));

  const { response, body } = await fetchApiJson(
    `${env.VITE_SERVER_URL}/api/logs?${searchParams.toString()}`,
  );

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to load audit logs.");
  }

  if (!isLogsResponse(body)) {
    throw new Error("Invalid audit logs response.");
  }

  return body;
}

function DetailField(props: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {props.label}
      </span>
      <span className="min-w-0 text-sm break-words">{props.value}</span>
    </div>
  );
}

function AuditLogDetails(props: { item: AuditLogItem; onClose: () => void }) {
  const changeRows = getAuditChangeRows(props.item.changes);

  return (
    <Card size="sm" className="border border-border shadow-none">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle>Log Details</CardTitle>
            <CardDescription>{props.item.summary}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={props.onClose}>
            <XIcon data-icon="inline-start" />
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailField label="Action" value={props.item.action} />
          <DetailField label="Category" value={props.item.category} />
          <DetailField label="Outcome" value={props.item.status} />
          <DetailField label="When" value={formatAuditDate(props.item.createdAt)} />
          <DetailField label="Actor" value={getActorLabel(props.item)} />
          <DetailField label="Department" value={getDepartmentLabel(props.item)} />
          <DetailField label="Target" value={getTargetLabel(props.item.targetType)} />
          <DetailField label="Target ID" value={formatOptionalValue(props.item.targetId)} />
          <DetailField label="Table" value={formatOptionalValue(props.item.tableName)} />
          <DetailField label="Row ID" value={formatOptionalValue(props.item.rowId)} />
          <DetailField label="IP" value={formatOptionalValue(props.item.ipAddress)} />
          <DetailField label="Request ID" value={formatOptionalValue(props.item.requestId)} />
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold tracking-widest uppercase">Changes</h2>
          {changeRows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Before</TableHead>
                  <TableHead>After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeRows.map((row) => (
                  <TableRow key={row.field}>
                    <TableCell className="font-medium">{row.field}</TableCell>
                    <TableCell className="max-w-[320px] break-words text-muted-foreground">
                      {row.from}
                    </TableCell>
                    <TableCell className="max-w-[320px] break-words">{row.to}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No field-level changes recorded.</p>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold tracking-widest uppercase">Metadata</h2>
            <pre className="max-h-64 overflow-auto bg-muted p-3 text-xs whitespace-pre-wrap">
              {formatJsonBlock(props.item.metadata)}
            </pre>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold tracking-widest uppercase">User Agent</h2>
            <pre className="max-h-64 overflow-auto bg-muted p-3 text-xs whitespace-pre-wrap">
              {formatOptionalValue(props.item.userAgent)}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RouteComponent() {
  const { accessContext } = authenticatedRoute.useRouteContext();
  const isReducedMotion = useReducedMotion() === true;
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LogsFilters>({
    search: "",
    action: "",
    category: "",
    status: "",
    targetType: "",
    dateFrom: "",
    dateTo: "",
  });
  const [exportFormat, setExportFormat] = useState<ExportFileFormat>("xlsx");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const debouncedSearch = useDebouncedValue(search, 300);
  const queryFilters = {
    ...filters,
    search: debouncedSearch,
  };
  const logsQuery = useQuery({
    queryKey: [
      "audit-logs",
      queryFilters.search,
      queryFilters.action,
      queryFilters.category,
      queryFilters.status,
      queryFilters.targetType,
      queryFilters.dateFrom,
      queryFilters.dateTo,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: () =>
      fetchLogs({
        ...queryFilters,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      }),
    enabled: accessContext.role === "system_admin",
  });
  const selectedLog = useMemo(() => {
    return logsQuery.data?.data.items.find((item) => item.id === selectedLogId) ?? null;
  }, [logsQuery.data, selectedLogId]);

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;

    setSearch(nextValue);
    setPagination((previous) => ({
      ...previous,
      pageIndex: 0,
    }));
  };

  const updateFilter = (key: keyof LogsFilters, value: string) => {
    setFilters((previous) => ({
      ...previous,
      [key]: value === "all" ? "" : value,
    }));
    setSelectedLogId(null);
    setPagination((previous) => ({
      ...previous,
      pageIndex: 0,
    }));
  };

  const clearFilters = () => {
    setSearch("");
    setFilters({
      search: "",
      action: "",
      category: "",
      status: "",
      targetType: "",
      dateFrom: "",
      dateTo: "",
    });
    setSelectedLogId(null);
    setPagination((previous) => ({
      ...previous,
      pageIndex: 0,
    }));
  };

  const handleExport = () => {
    const items = logsQuery.data?.data.items ?? [];

    if (items.length === 0) {
      showInfoToast("No visible audit logs to export.");
      return;
    }

    exportRecordsFile({
      rows: toExportRows(items),
      sheetName: "Audit Logs",
      filename: buildExportFilename({
        baseName: "audit_logs",
        suffix: new Date().toISOString().slice(0, 10),
        format: exportFormat,
      }),
      format: exportFormat,
    });
  };

  const totalRows = logsQuery.data?.data.pagination.totalRows ?? 0;
  const pageCount = Math.max(Math.ceil(totalRows / pagination.pageSize), 1);
  const canPreviousPage = pagination.pageIndex > 0;
  const canNextPage = pagination.pageIndex < pageCount - 1;
  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(filters.action) ||
    Boolean(filters.category) ||
    Boolean(filters.status) ||
    Boolean(filters.targetType) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);

  if (accessContext.role !== "system_admin") {
    return (
      <motion.main
        className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6"
        {...getEnterAnimationProps(isReducedMotion)}
      >
        <Card>
          <CardHeader>
            <CardTitle>Logs Access</CardTitle>
            <CardDescription>Only system admins can view audit logs.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/" className={buttonVariants({ variant: "default" })}>
              <ArrowLeftIcon data-icon="inline-start" />
              Back
            </Link>
          </CardContent>
        </Card>
      </motion.main>
    );
  }

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
            <ListBulletsIcon className="mb-1 size-5 text-primary" weight="duotone" />
            Audit Logs
          </h1>
          <p className="text-sm text-muted-foreground">
            Review security, access, import, and table activity across the system.
          </p>
        </div>
        <Link to="/" className={buttonVariants({ variant: "default" })}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Link>
      </motion.div>

      <motion.div
        className="flex flex-col gap-4"
        {...getEnterAnimationProps(isReducedMotion, 0.06, 12)}
      >
        <Card>
          <CardHeader>
            <CardTitle>Activity Controls</CardTitle>
            <CardDescription>
              Filter logs, inspect event details, and export the visible page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(150px,1fr))]">
              <div className="flex flex-col gap-2">
                <label htmlFor="log-search" className="text-sm font-medium">
                  <span className="mr-2 inline-flex align-middle">
                    <MagnifyingGlassIcon className="mb-1 size-4 text-primary" weight="duotone" />
                  </span>
                  Search
                </label>
                <Input
                  id="log-search"
                  value={search}
                  onChange={handleSearchChange}
                  placeholder="Summary, table, actor, department"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Action</label>
                <Select
                  items={auditActionOptions}
                  value={filters.action || "all"}
                  onValueChange={(value) => updateFilter("action", value ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent>
                    {auditActionOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Category</label>
                <Select
                  items={auditCategoryOptions}
                  value={filters.category || "all"}
                  onValueChange={(value) => updateFilter("category", value ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    {auditCategoryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Outcome</label>
                <Select
                  items={auditStatusOptions}
                  value={filters.status || "all"}
                  onValueChange={(value) => updateFilter("status", value ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All outcomes" />
                  </SelectTrigger>
                  <SelectContent>
                    {auditStatusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Target</label>
                <Select
                  items={auditTargetTypeOptions}
                  value={filters.targetType || "all"}
                  onValueChange={(value) => updateFilter("targetType", value ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All targets" />
                  </SelectTrigger>
                  <SelectContent>
                    {auditTargetTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[repeat(2,minmax(180px,1fr))_minmax(180px,220px)_auto_auto] md:items-end">
              <div className="flex flex-col gap-2">
                <label htmlFor="date-from" className="text-sm font-medium">
                  From
                </label>
                <Input
                  id="date-from"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => updateFilter("dateFrom", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="date-to" className="text-sm font-medium">
                  To
                </label>
                <Input
                  id="date-to"
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => updateFilter("dateTo", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Export</label>
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
              <Button variant="outline" disabled={!hasActiveFilters} onClick={clearFilters}>
                <FunnelSimpleIcon data-icon="inline-start" />
                Clear
              </Button>
              <Button disabled={logsQuery.isLoading || logsQuery.isError} onClick={handleExport}>
                <DownloadSimpleIcon data-icon="inline-start" />
                Export Page
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedLog ? (
          <AuditLogDetails item={selectedLog} onClose={() => setSelectedLogId(null)} />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              {totalRows} matching log{totalRows === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {logsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading logs...</p>
            ) : logsQuery.isError ? (
              <p className="text-sm text-destructive">
                {logsQuery.error instanceof Error
                  ? logsQuery.error.message
                  : "Failed to load audit logs."}
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Summary</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead className="text-right">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsQuery.data && logsQuery.data.data.items.length > 0 ? (
                      logsQuery.data.data.items.map((item) => (
                        <TableRow
                          key={item.id}
                          className={cn(selectedLogId === item.id && "bg-muted/60")}
                        >
                          <TableCell className="whitespace-nowrap">
                            {formatAuditDate(item.createdAt)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn("font-medium", getAuditActionClassName(item.action))}
                            >
                              {item.action}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "inline-flex items-center px-2 py-1 text-xs font-semibold tracking-widest uppercase ring-1",
                                getAuditStatusClassName(item.status),
                              )}
                            >
                              {item.status}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[340px]">
                            <span className="line-clamp-2">{item.summary}</span>
                          </TableCell>
                          <TableCell>{getActorLabel(item)}</TableCell>
                          <TableCell>{getDepartmentLabel(item)}</TableCell>
                          <TableCell>
                            {getTargetLabel(item.targetType)}
                            {item.rowId ? (
                              <span className="block text-xs text-muted-foreground">
                                row {item.rowId}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setSelectedLogId((previous) =>
                                  previous === item.id ? null : item.id,
                                )
                              }
                            >
                              <EyeIcon data-icon="inline-start" />
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center">
                          No audit logs found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
                  <div className="text-sm text-muted-foreground sm:mr-1">
                    {`${totalRows} total log(s)`}
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
                    Page {pagination.pageIndex + 1} of {pageCount}
                  </div>

                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!canPreviousPage || logsQuery.isFetching}
                    onClick={() =>
                      setPagination((previous) => ({
                        ...previous,
                        pageIndex: previous.pageIndex - 1,
                      }))
                    }
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!canNextPage || logsQuery.isFetching}
                    onClick={() =>
                      setPagination((previous) => ({
                        ...previous,
                        pageIndex: previous.pageIndex + 1,
                      }))
                    }
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.main>
  );
}
