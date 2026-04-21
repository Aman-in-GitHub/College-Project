import { ArrowLeftIcon, ListBulletsIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { type PaginationState } from "@tanstack/react-table";
import { motion, useReducedMotion } from "motion/react";
import { useState, type ChangeEvent } from "react";

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
import { fetchApiJson, getEnterAnimationProps, isRecord, useDebouncedValue } from "@/lib/utils";

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

type AuditLogItem = {
  id: string;
  action: string;
  summary: string;
  tableName: string | null;
  rowId: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string;
    email: string;
  } | null;
  department: {
    id: string;
    name: string;
    slug: string;
  } | null;
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

function isAuditLogItem(value: unknown): value is AuditLogItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.action === "string" &&
    typeof value.summary === "string" &&
    (typeof value.tableName === "string" || value.tableName === null) &&
    (typeof value.rowId === "string" || value.rowId === null) &&
    typeof value.createdAt === "string"
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

async function fetchLogs(params: {
  search: string;
  action: string;
  page: number;
  pageSize: number;
}): Promise<LogsResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
    action: params.action,
  });
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

function RouteComponent() {
  const { accessContext } = authenticatedRoute.useRouteContext();
  const isReducedMotion = useReducedMotion() === true;
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const debouncedSearch = useDebouncedValue(search, 300);
  const logsQuery = useQuery({
    queryKey: ["audit-logs", debouncedSearch, action, pagination.pageIndex, pagination.pageSize],
    queryFn: () =>
      fetchLogs({
        search: debouncedSearch,
        action,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      }),
    enabled: accessContext.role === "system_admin",
  });

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;

    setSearch(nextValue);
    setPagination((previous) => ({
      ...previous,
      pageIndex: 0,
    }));
  };

  const totalRows = logsQuery.data?.data.pagination.totalRows ?? 0;
  const pageCount = Math.max(Math.ceil(totalRows / pagination.pageSize), 1);
  const canPreviousPage = pagination.pageIndex > 0;
  const canNextPage = pagination.pageIndex < pageCount - 1;

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
              <ArrowLeftIcon className="mb-1 size-4" weight="bold" />
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
            Review key table and import actions across the system.
          </p>
        </div>
        <Link to="/" className={buttonVariants({ variant: "default" })}>
          <ArrowLeftIcon className="mb-1 size-4" weight="bold" />
          Back
        </Link>
      </motion.div>

      <motion.div {...getEnterAnimationProps(isReducedMotion, 0.06, 12)}>
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Search and filter audit events.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-[1fr_220px]">
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
                  placeholder="Search summary, table, actor, or department"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Action</label>
                <Select
                  items={[
                    { value: "all", label: "All actions" },
                    { value: "table_create", label: "Table created" },
                    { value: "row_import", label: "Rows imported" },
                    { value: "row_create", label: "Row created" },
                    { value: "row_update", label: "Row updated" },
                    { value: "row_delete", label: "Row deleted" },
                    { value: "user.created", label: "User created" },
                    { value: "user.banned", label: "User banned" },
                    { value: "user.unbanned", label: "User unbanned" },
                    { value: "session.revoked", label: "Session revoked" },
                    { value: "membership.created", label: "Member added" },
                    { value: "department.created", label: "Department created" },
                  ]}
                  value={action || "all"}
                  onValueChange={(value) => setAction(value === "all" ? "" : (value ?? ""))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    <SelectItem value="table_create">Table created</SelectItem>
                    <SelectItem value="row_import">Rows imported</SelectItem>
                    <SelectItem value="row_create">Row created</SelectItem>
                    <SelectItem value="row_update">Row updated</SelectItem>
                    <SelectItem value="row_delete">Row deleted</SelectItem>
                    <SelectItem value="user.created">User created</SelectItem>
                    <SelectItem value="user.banned">User banned</SelectItem>
                    <SelectItem value="user.unbanned">User unbanned</SelectItem>
                    <SelectItem value="session.revoked">Session revoked</SelectItem>

                    <SelectItem value="membership.created">Member added</SelectItem>
                    <SelectItem value="department.created">Department created</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

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
                      <TableHead>Summary</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Table</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsQuery.data && logsQuery.data.data.items.length > 0 ? (
                      logsQuery.data.data.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell>
                          <TableCell>{item.action}</TableCell>
                          <TableCell>{item.summary}</TableCell>
                          <TableCell>
                            {item.actor ? `${item.actor.name} (${item.actor.email})` : "-"}
                          </TableCell>
                          <TableCell>
                            {item.department
                              ? `${item.department.name} (${item.department.slug})`
                              : "-"}
                          </TableCell>
                          <TableCell>{item.tableName ?? "-"}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center">
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
                    items={[
                      { value: "10", label: "10 / page" },
                      { value: "20", label: "20 / page" },
                      { value: "50", label: "50 / page" },
                    ]}
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
                      <SelectItem value="10">10 / page</SelectItem>
                      <SelectItem value="20">20 / page</SelectItem>
                      <SelectItem value="50">50 / page</SelectItem>
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
