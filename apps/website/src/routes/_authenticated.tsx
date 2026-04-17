import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data, error } = await authClient.getSession();

    if (error || !data) {
      throw redirect({
        to: "/login",
      });
    }

    return { user: data.user };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
