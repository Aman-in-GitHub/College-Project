import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth";
import { env } from "@/lib/env";
import { fetchApiJson, isRecord } from "@/lib/utils";

type AccessRole = "system_admin" | "department_admin" | "department_staff" | "unassigned";

type AccessContextData = {
  user: {
    id: string;
    name: string;
    email: string;
    username: string | null;
  };
  role: AccessRole;
  department: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

function isAccessRole(value: unknown): value is AccessRole {
  return (
    value === "system_admin" ||
    value === "department_admin" ||
    value === "department_staff" ||
    value === "unassigned"
  );
}

function isDepartmentSummary(
  value: unknown,
): value is NonNullable<AccessContextData["department"]> {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.slug === "string"
  );
}

function isAccessUser(value: unknown): value is AccessContextData["user"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    (typeof value.username === "string" || value.username === null)
  );
}

function isAccessContextData(value: unknown): value is AccessContextData {
  return (
    isRecord(value) &&
    isAccessUser(value.user) &&
    isAccessRole(value.role) &&
    (value.department === null || isDepartmentSummary(value.department))
  );
}

function isAccessContextResponse(value: unknown): value is {
  success: boolean;
  message: string;
  data: AccessContextData;
} {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.message === "string" &&
    isAccessContextData(value.data)
  );
}

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data, error } = await authClient.getSession();

    if (error || !data) {
      throw redirect({
        to: "/login",
      });
    }

    const { response, body } = await fetchApiJson(`${env.VITE_SERVER_URL}/api/access/context`);

    if (response.status === 401) {
      throw redirect({
        to: "/login",
      });
    }

    if (!response.ok || !isAccessContextResponse(body) || !body.success) {
      throw new Error("Failed to load access context.");
    }

    return {
      user: data.user,
      accessContext: body.data,
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { accessContext } = Route.useRouteContext();

  const roleTheme = accessContext.role === "unassigned" ? undefined : accessContext.role;

  return (
    <div data-role-theme={roleTheme} className="min-h-svh">
      <Outlet />
    </div>
  );
}
