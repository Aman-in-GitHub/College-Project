import {
  CameraIcon,
  EraserIcon,
  HouseLineIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SignOutIcon,
  TableIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useRef, useState, type ChangeEvent } from "react";

import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { authClient } from "@/lib/auth";
import { FALLBACK_COLUMN_TYPES } from "@/lib/constants";
import { env } from "@/lib/env";
import {
  fetchApiJson,
  getEnterAnimationProps,
  getExitAnimationProps,
  getHoverLiftProps,
  isRecord,
  showErrorToast,
  showInfoToast,
  showSuccessToast,
  showWarningToast,
} from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: "Dashboard | College Project",
      },
    ],
  }),
});

const authenticatedRoute = getRouteApi("/_authenticated");

type DbColumnType = (typeof FALLBACK_COLUMN_TYPES)[number];

type ScannedColumn = {
  name: string;
  inferredType: DbColumnType;
  values: string[];
};

type EditableColumn = {
  name: string;
  type: DbColumnType;
  isRequired: boolean;
};

type ScanTable = {
  columns: ScannedColumn[];
};

type ScanResponse = {
  success: boolean;
  message: string;
  data: {
    department: {
      id: string;
      name: string;
      slug: string;
    } | null;
    tables: ScanTable[];
    columnTypes: DbColumnType[];
  };
};

type CreateTableResponse = {
  success: boolean;
  message: string;
  data: {
    department: {
      id: string;
      name: string;
      slug: string;
    };
    baseTableName: string;
    tableName: string;
    columns: Array<{
      name: string;
      type: DbColumnType;
      isRequired: boolean;
    }>;
  };
};

type AccessRole = "system_admin" | "department_admin" | "department_staff" | "unassigned";

type ManagedUserItem = {
  id: string;
  role: "department_admin" | "department_staff";
  createdAt: string;
  department: {
    id: string;
    name: string;
    slug: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
    username: string | null;
    isBanned: boolean;
  };
};

type ManagedUsersResponse = {
  success: boolean;
  message: string;
  data: {
    role: AccessRole;
    items: ManagedUserItem[];
  };
};

type DepartmentTablesResponse = {
  success: boolean;
  message: string;
  data: {
    department: {
      id: string;
      name: string;
      slug: string;
    };
    tables: Array<{
      tableName: string;
      fullTableName: string;
      href: string;
    }>;
  };
};

function toScanRows(columns: ScannedColumn[]): string[][] {
  const rowCount = columns.reduce(
    (maxCount, column) => Math.max(maxCount, column.values.length),
    0,
  );

  return Array.from({ length: rowCount }, (_, rowIndex) =>
    columns.map((column) => column.values[rowIndex] ?? ""),
  );
}

function formatSampleValues(values: string[]): string {
  const previewValues = values.slice(0, 3).map((value) => (value.trim() ? value : "null"));

  return previewValues.join(", ") || "No samples";
}

function isDbColumnType(value: string | null): value is DbColumnType {
  return value !== null && FALLBACK_COLUMN_TYPES.some((columnType) => columnType === value);
}

function isScanResponse(value: unknown): value is ScanResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    Array.isArray(value.data.tables) &&
    Array.isArray(value.data.columnTypes)
  );
}

function isCreateTableResponse(value: unknown): value is CreateTableResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    isRecord(value.data.department) &&
    typeof value.data.department.slug === "string" &&
    typeof value.data.baseTableName === "string"
  );
}

function isAccessRole(value: unknown): value is AccessRole {
  return (
    value === "system_admin" ||
    value === "department_admin" ||
    value === "department_staff" ||
    value === "unassigned"
  );
}

function isManagedUserItem(value: unknown): value is ManagedUserItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "department_admin" || value.role === "department_staff") &&
    typeof value.createdAt === "string" &&
    isRecord(value.department) &&
    typeof value.department.id === "string" &&
    typeof value.department.name === "string" &&
    typeof value.department.slug === "string" &&
    isRecord(value.user) &&
    typeof value.user.id === "string" &&
    typeof value.user.name === "string" &&
    typeof value.user.email === "string" &&
    (typeof value.user.username === "string" || value.user.username === null) &&
    typeof value.user.isBanned === "boolean"
  );
}

function isManagedUsersResponse(value: unknown): value is ManagedUsersResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    isAccessRole(value.data.role) &&
    Array.isArray(value.data.items) &&
    value.data.items.every((item) => isManagedUserItem(item))
  );
}

function isDepartmentTablesResponse(value: unknown): value is DepartmentTablesResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    isRecord(value.data.department) &&
    typeof value.data.department.id === "string" &&
    typeof value.data.department.name === "string" &&
    typeof value.data.department.slug === "string" &&
    Array.isArray(value.data.tables) &&
    value.data.tables.every(
      (table) =>
        isRecord(table) &&
        typeof table.tableName === "string" &&
        typeof table.fullTableName === "string" &&
        typeof table.href === "string",
    )
  );
}

async function fetchManagedUsers(): Promise<ManagedUsersResponse> {
  const { response, body } = await fetchApiJson(`${env.VITE_SERVER_URL}/api/access/managed-users`);

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to load managed users.");
  }

  if (!isManagedUsersResponse(body)) {
    throw new Error("Managed users response is invalid.");
  }

  return body;
}

async function banManagedUser(userId: string): Promise<{ success: boolean; message: string }> {
  const { response, body } = await fetchApiJson(`${env.VITE_SERVER_URL}/api/access/ban`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
    }),
  });

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to ban user.");
  }

  if (
    !isRecord(body) ||
    typeof body.success !== "boolean" ||
    typeof body.message !== "string" ||
    body.success !== true
  ) {
    throw new Error("Ban response is invalid.");
  }

  return {
    success: body.success,
    message: body.message,
  };
}

async function unbanManagedUser(userId: string): Promise<{ success: boolean; message: string }> {
  const { response, body } = await fetchApiJson(`${env.VITE_SERVER_URL}/api/access/unban`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
    }),
  });

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Failed to unban user.");
  }

  if (
    !isRecord(body) ||
    typeof body.success !== "boolean" ||
    typeof body.message !== "string" ||
    body.success !== true
  ) {
    throw new Error("Unban response is invalid.");
  }

  return {
    success: body.success,
    message: body.message,
  };
}

async function fetchDepartmentTables(departmentSlug: string): Promise<DepartmentTablesResponse> {
  const { response, body } = await fetchApiJson(`${env.VITE_SERVER_URL}/api/tables`, {
    headers: {
      "x-department-slug": departmentSlug,
    },
  });

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    if (isRecord(body) && typeof body.error === "string") {
      throw new Error(body.error);
    }

    throw new Error("Failed to load department tables.");
  }

  if (!isDepartmentTablesResponse(body)) {
    throw new Error("Department tables response is invalid.");
  }

  return body;
}

async function scanTableRequest({
  departmentSlug,
  file,
  requestId: _requestId,
}: {
  departmentSlug: string;
  file: File;
  requestId: number;
}): Promise<ScanResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const { response, body } = await fetchApiJson(`${env.VITE_SERVER_URL}/api/table/scan`, {
    method: "POST",
    headers: {
      "x-department-slug": departmentSlug,
    },
    body: formData,
  });

  if (!response.ok) {
    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    if (isRecord(body) && typeof body.error === "string") {
      throw new Error(body.error);
    }

    throw new Error("Scan failed");
  }

  if (!isScanResponse(body)) {
    throw new Error("Scan returned an invalid response");
  }

  return body;
}

async function createTableRequest(payload: {
  departmentSlug: string;
  tableName: string;
  columns: EditableColumn[];
  fillData: boolean;
  rows: string[][];
}): Promise<CreateTableResponse> {
  const { response, body } = await fetchApiJson(`${env.VITE_SERVER_URL}/api/table/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-department-slug": payload.departmentSlug,
    },
    body: JSON.stringify({
      tableName: payload.tableName,
      columns: payload.columns,
      fillData: payload.fillData,
      rows: payload.rows,
    }),
  });

  if (!response.ok || !isCreateTableResponse(body) || !body.success) {
    let issueMessage: string | null = null;

    if (isRecord(body) && isRecord(body.data) && Array.isArray(body.data.issues)) {
      const issueParts = body.data.issues
        .map((issue) => {
          if (!isRecord(issue)) {
            return null;
          }

          if (typeof issue.path !== "string" || typeof issue.message !== "string") {
            return null;
          }

          return `${issue.path}: ${issue.message}`;
        })
        .filter((issue): issue is string => issue !== null);

      issueMessage = issueParts.length > 0 ? issueParts.join("; ") : null;
    }

    const message =
      isRecord(body) && typeof body.message === "string"
        ? body.message
        : isRecord(body) && typeof body.error === "string"
          ? body.error
          : "Table creation failed";

    throw new Error(issueMessage ?? message);
  }

  return body;
}

function RouteComponent() {
  const { accessContext } = authenticatedRoute.useRouteContext();
  const navigate = useNavigate();
  const isReducedMotion = useReducedMotion() === true;
  const department = accessContext.department;
  const isSystemAdmin = accessContext.role === "system_admin";
  const isDepartmentAdmin = accessContext.role === "department_admin" && department !== null;
  const isDepartmentStaff = accessContext.role === "department_staff" && department !== null;
  const canLoadDepartmentTables = isDepartmentAdmin || isDepartmentStaff;
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editableSchemas, setEditableSchemas] = useState<EditableColumn[][]>([]);
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);
  const [tableName, setTableName] = useState("");
  const [isFillDataEnabled, setIsFillDataEnabled] = useState(true);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const schemaEditorRef = useRef<HTMLDivElement | null>(null);
  const previewSectionRef = useRef<HTMLDivElement | null>(null);
  const scanRequestIdRef = useRef(0);
  const managedUsersQuery = useQuery({
    queryKey: ["managed-users", accessContext.role, department?.id ?? null],
    queryFn: fetchManagedUsers,
    enabled: isSystemAdmin || isDepartmentAdmin,
  });
  const banUserMutation = useMutation({
    mutationFn: banManagedUser,
    onSuccess: (payload) => {
      showSuccessToast(payload.message);
      void managedUsersQuery.refetch();
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Failed to ban user.");
    },
  });
  const unbanUserMutation = useMutation({
    mutationFn: unbanManagedUser,
    onSuccess: (payload) => {
      showSuccessToast(payload.message);
      void managedUsersQuery.refetch();
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Failed to unban user.");
    },
  });
  const departmentTablesQuery = useQuery({
    queryKey: ["department-tables", department?.slug ?? null],
    queryFn: () => {
      if (!department) {
        throw new Error("Department context is required.");
      }

      return fetchDepartmentTables(department.slug);
    },
    enabled: canLoadDepartmentTables,
  });
  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();

      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      navigate({ to: "/login" });
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Logout failed");
    },
  });

  const scanMutation = useMutation({
    mutationFn: scanTableRequest,
    onSuccess: (payload, variables) => {
      if (variables.requestId !== scanRequestIdRef.current) {
        return;
      }

      setEditableSchemas(
        payload.data.tables.map((table) =>
          table.columns.map((column) => ({
            name: column.name,
            type: column.inferredType,
            isRequired: false,
          })),
        ),
      );
      setSelectedTableIndex(0);

      if (payload.data.tables.length > 0) {
        showInfoToast(payload.message || "Table scan complete.");
      } else {
        showWarningToast(payload.message || "No table found in the uploaded image.");
      }
    },
    onError: (error, variables) => {
      if (variables.requestId !== scanRequestIdRef.current) {
        return;
      }

      showErrorToast(error instanceof Error ? error.message : "Scan failed");
    },
  });

  const createTableMutation = useMutation({
    mutationFn: createTableRequest,
    onSuccess: (payload) => {
      showSuccessToast(payload.message || "Table created successfully.");
      navigate({
        to: "/$departmentSlug/$tableName",
        params: {
          departmentSlug: payload.data.department.slug,
          tableName: payload.data.baseTableName,
        },
      });
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Table creation failed");
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

  const scrollPreviewIntoView = useEffectEvent(() => {
    previewSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });

  const scrollSchemaEditorIntoView = useEffectEvent(() => {
    schemaEditorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });

  const scheduleSmoothScroll = useEffectEvent((scrollFn: () => void) => {
    let firstAnimationFrameId = 0;
    let secondAnimationFrameId = 0;

    firstAnimationFrameId = window.requestAnimationFrame(() => {
      secondAnimationFrameId = window.requestAnimationFrame(() => {
        scrollFn();
      });
    });

    return () => {
      window.cancelAnimationFrame(firstAnimationFrameId);
      window.cancelAnimationFrame(secondAnimationFrameId);
    };
  });

  useEffect(() => {
    if (!previewUrl) {
      return;
    }

    return scheduleSmoothScroll(scrollPreviewIntoView);
  }, [previewUrl, scheduleSmoothScroll, scrollPreviewIntoView]);

  const scanResult = scanMutation.data?.data.tables ?? [];
  const availableTypes =
    scanMutation.data && scanMutation.data.data.columnTypes.length > 0
      ? scanMutation.data.data.columnTypes
      : [...FALLBACK_COLUMN_TYPES];
  const activeTableIndex =
    scanResult.length === 0 ? 0 : Math.min(selectedTableIndex, scanResult.length - 1);

  const currentColumns = editableSchemas[activeTableIndex] ?? [];
  const currentSampleColumns = scanResult[activeTableIndex]?.columns ?? [];
  const currentRows = toScanRows(currentSampleColumns);
  const selectedTableLabel =
    scanResult.length > 0 ? `Table ${activeTableIndex + 1}` : "Select table";

  useEffect(() => {
    if (selectedTableIndex >= scanResult.length && scanResult.length > 0) {
      setSelectedTableIndex(0);
    }
  }, [scanResult.length, selectedTableIndex]);

  useEffect(() => {
    if (scanResult.length > 0) {
      return scheduleSmoothScroll(scrollSchemaEditorIntoView);
    }
  }, [scanResult.length, scheduleSmoothScroll, scrollSchemaEditorIntoView]);

  function resetFormState() {
    scanRequestIdRef.current += 1;
    setSelectedFile(null);
    setPreviewUrl(null);
    setEditableSchemas([]);
    setSelectedTableIndex(0);
    setTableName("");
    setIsFillDataEnabled(true);
    scanMutation.reset();
    createTableMutation.reset();
  }

  function clearSelection() {
    resetFormState();
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
  }

  function onSelectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const inputId = event.target.id;

    resetFormState();
    setSelectedFile(file);

    if (inputId === "camera-photo" && uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }

    if (inputId === "upload-photo" && cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
  }

  async function scanTable() {
    if (!selectedFile) {
      showWarningToast("Please take or upload a photo first.");
      return;
    }

    if (!isDepartmentAdmin) {
      showWarningToast("Only department admins can scan tables.");
      return;
    }

    await scanMutation.mutateAsync({
      departmentSlug: department.slug,
      file: selectedFile,
      requestId: ++scanRequestIdRef.current,
    });
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

  function updateColumnRequired(columnIndex: number, isRequired: boolean) {
    setEditableSchemas((previous) =>
      previous.map((tableColumns, tableIndex) => {
        if (tableIndex !== activeTableIndex) {
          return tableColumns;
        }

        return tableColumns.map((column, index) =>
          index === columnIndex ? { ...column, isRequired } : column,
        );
      }),
    );
  }

  async function createTable() {
    if (currentColumns.length === 0) {
      showWarningToast("No scanned columns to create a table from.");
      return;
    }

    if (!tableName.trim()) {
      showWarningToast("Please provide a table name.");
      return;
    }

    if (!isDepartmentAdmin) {
      showWarningToast("Only department admins can create tables.");
      return;
    }

    await createTableMutation.mutateAsync({
      departmentSlug: department.slug,
      tableName,
      columns: currentColumns,
      fillData: isFillDataEnabled,
      rows: isFillDataEnabled ? currentRows : [],
    });
  }

  return (
    <motion.main
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-6"
      {...getEnterAnimationProps(isReducedMotion)}
    >
      <motion.div
        className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        {...getEnterAnimationProps(isReducedMotion, 0.03)}
      >
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <HouseLineIcon className="mb-1 size-5 text-primary" weight="duotone" />
            {isSystemAdmin
              ? "Department Admins"
              : isDepartmentAdmin
                ? "Department Dashboard"
                : isDepartmentStaff
                  ? "Department Access"
                  : "Access"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSystemAdmin
              ? "Create departments and assign department admins."
              : isDepartmentAdmin
                ? `Manage staff and digitize tables for ${department.name}.`
                : isDepartmentStaff
                  ? `You have view-only access for ${department.name}.`
                  : "No department role has been assigned to this account yet."}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          {(isSystemAdmin || isDepartmentAdmin) && (
            <Link to="/create" className={buttonVariants({ className: "w-full sm:w-auto" })}>
              <PlusIcon className="mb-1 size-4" weight="bold" />
              Create New
            </Link>
          )}
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            disabled={signOutMutation.isPending}
            onClick={() => void signOutMutation.mutateAsync()}
          >
            <SignOutIcon className="mb-1 size-4" weight="bold" />
            {signOutMutation.isPending ? "Logging out..." : "Logout"}
          </Button>
          <div className="flex w-full sm:w-auto">
            <ModeToggle />
          </div>
        </div>
      </motion.div>

      {(isSystemAdmin || isDepartmentAdmin) && (
        <motion.div {...getEnterAnimationProps(isReducedMotion, 0.06, 14)}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UsersThreeIcon className="mb-1 size-5 text-primary" weight="duotone" />
                {isSystemAdmin ? "Created Department Admins" : "Created Staff"}
              </CardTitle>
              <CardDescription>
                {isSystemAdmin
                  ? "Department admins created from this account are listed here."
                  : "Staff accounts created from this department admin account are listed here."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {managedUsersQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : managedUsersQuery.isError ? (
                <p className="text-sm text-destructive">
                  {managedUsersQuery.error instanceof Error
                    ? managedUsersQuery.error.message
                    : "Failed to load users."}
                </p>
              ) : managedUsersQuery.data && managedUsersQuery.data.data.items.length > 0 ? (
                managedUsersQuery.data.data.items.map((item, index) => (
                  <motion.div
                    key={item.id}
                    className="flex flex-col gap-1 border p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
                    {...getEnterAnimationProps(isReducedMotion, index * 0.03, 8)}
                  >
                    <div className="flex flex-col gap-1">
                      <p className="font-medium">{item.user.name}</p>
                      <p className="text-muted-foreground">{item.user.email}</p>
                      {isSystemAdmin ? (
                        <p className="text-muted-foreground">
                          {item.department.name} ({item.department.slug})
                        </p>
                      ) : null}
                      {item.user.isBanned ? <p className="text-destructive">Banned</p> : null}
                    </div>
                    <div className="flex flex-col gap-3 sm:items-end">
                      <div className="text-sm text-muted-foreground">
                        {item.user.username ? `@${item.user.username}` : item.role}
                      </div>
                      <Button
                        type="button"
                        variant={item.user.isBanned ? "outline" : "destructive"}
                        className="w-full sm:w-auto"
                        disabled={banUserMutation.isPending || unbanUserMutation.isPending}
                        onClick={() =>
                          item.user.isBanned
                            ? void unbanUserMutation.mutateAsync(item.user.id)
                            : void banUserMutation.mutateAsync(item.user.id)
                        }
                      >
                        {item.user.isBanned
                          ? unbanUserMutation.isPending
                            ? "Unbanning..."
                            : "Unban"
                          : banUserMutation.isPending
                            ? "Banning..."
                            : "Ban"}
                      </Button>
                    </div>
                  </motion.div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isSystemAdmin ? "No department admins created yet." : "No staff created yet."}
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {canLoadDepartmentTables ? (
        <motion.div {...getEnterAnimationProps(isReducedMotion, 0.09, 14)}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TableIcon className="mb-1 size-5 text-primary" weight="duotone" />
                Tables
              </CardTitle>
              <CardDescription>Open digitized tables for {department.name}.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {departmentTablesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading tables...</p>
              ) : departmentTablesQuery.isError ? (
                <p className="text-sm text-destructive">
                  {departmentTablesQuery.error instanceof Error
                    ? departmentTablesQuery.error.message
                    : "Failed to load tables."}
                </p>
              ) : departmentTablesQuery.data &&
                departmentTablesQuery.data.data.tables.length > 0 ? (
                departmentTablesQuery.data.data.tables.map((table, index) => (
                  <motion.div
                    key={table.fullTableName}
                    {...getEnterAnimationProps(isReducedMotion, index * 0.03, 8)}
                    {...getHoverLiftProps(isReducedMotion)}
                  >
                    <Link
                      to="/$departmentSlug/$tableName"
                      params={{
                        departmentSlug: department.slug,
                        tableName: table.tableName,
                      }}
                      className="block border p-4 text-sm transition-colors hover:bg-muted"
                    >
                      <div className="font-medium">{table.tableName}</div>
                      <div className="text-muted-foreground">{table.fullTableName}</div>
                    </Link>
                  </motion.div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No tables created yet.</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ) : null}

      {isDepartmentAdmin ? (
        <>
          <motion.div {...getEnterAnimationProps(isReducedMotion, 0.12, 14)}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CameraIcon className="mb-1 size-5 text-primary" weight="duotone" />
                  Photo Input
                </CardTitle>
                <CardDescription>Choose one method: camera or upload.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="camera-photo">Take Photo</Label>
                    <Input
                      id="camera-photo"
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={onSelectFile}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="upload-photo">Upload Photo</Label>
                    <Input
                      id="upload-photo"
                      ref={uploadInputRef}
                      type="file"
                      accept="image/*"
                      onChange={onSelectFile}
                    />
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {previewUrl ? (
                    <motion.div
                      key="photo-preview"
                      ref={previewSectionRef}
                      className="flex flex-col gap-3"
                      {...getExitAnimationProps(isReducedMotion, 10)}
                    >
                      <img
                        src={previewUrl}
                        alt="Selected table preview"
                        className="max-h-96 w-full object-contain"
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    disabled={
                      !selectedFile || scanMutation.isPending || createTableMutation.isPending
                    }
                    onClick={scanTable}
                  >
                    <MagnifyingGlassIcon className="mb-1 size-4" weight="bold" />
                    {scanMutation.isPending ? "Scanning..." : "Scan Table"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!selectedFile && scanResult.length === 0 && !previewUrl}
                    onClick={clearSelection}
                  >
                    <EraserIcon className="mb-1 size-4" weight="bold" />
                    Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <AnimatePresence initial={false}>
            {scanResult.length > 0 ? (
              <motion.div
                key="schema-editor"
                ref={schemaEditorRef}
                {...getExitAnimationProps(isReducedMotion, 12)}
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TableIcon className="mb-1 size-5 text-primary" weight="duotone" />
                      Schema Editor
                    </CardTitle>
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

                    <div className="overflow-x-auto border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Required</TableHead>
                            <TableHead className="min-w-48">Column Name</TableHead>
                            <TableHead className="w-56">Data Type</TableHead>
                            <TableHead className="min-w-56">Sample Values</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentColumns.map((column, index) => (
                            <TableRow key={`column-${index}`}>
                              <TableCell>
                                <Checkbox
                                  id={`column-required-${index}`}
                                  checked={column.isRequired}
                                  onCheckedChange={(checked) =>
                                    updateColumnRequired(index, checked === true)
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  id={`column-name-${index}`}
                                  value={column.name}
                                  onChange={(event) => updateColumnName(index, event.target.value)}
                                />
                              </TableCell>
                              <TableCell>
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
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {formatSampleValues(currentSampleColumns[index]?.values ?? [])}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="fill-data"
                          checked={isFillDataEnabled}
                          onCheckedChange={(checked) => setIsFillDataEnabled(checked === true)}
                        />
                        <Label htmlFor="fill-data" className="cursor-pointer">
                          Fill data from photo into table
                        </Label>
                      </div>

                      <Button
                        type="button"
                        disabled={
                          scanMutation.isPending ||
                          createTableMutation.isPending ||
                          currentColumns.length === 0
                        }
                        onClick={createTable}
                      >
                        <PlusIcon className="mb-1 size-4" weight="bold" />
                        {createTableMutation.isPending ? "Creating..." : "Create Table"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      ) : null}

      {accessContext.role === "department_staff" ? (
        <motion.div {...getEnterAnimationProps(isReducedMotion, 0.12, 12)}>
          <Card>
            <CardHeader>
              <CardTitle>View Only</CardTitle>
              <CardDescription>
                Department staff can open tables and view department data but cannot create staff,
                scan tables, or create tables.
              </CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      ) : null}

      {accessContext.role === "unassigned" ? (
        <motion.div {...getEnterAnimationProps(isReducedMotion, 0.12, 12)}>
          <Card>
            <CardHeader>
              <CardTitle>No Role Assigned</CardTitle>
              <CardDescription>
                This account is signed in but has not been assigned a system or department role yet.
              </CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      ) : null}
    </motion.main>
  );
}
