import type { QueryClient } from "@tanstack/react-query";

import { ProgressProvider, useProgress } from "@bprogress/react";
import { Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

export type RouterContext = {
  queryClient: QueryClient;
};

function NavigationProgress() {
  const { start, stop } = useProgress();

  const status = useRouterState({ select: (s) => s.status });

  const syncProgress = useEffectEvent(() => {
    if (status === "pending") {
      start();
    } else {
      stop();
    }
  });

  useEffect(() => {
    syncProgress();
  }, [status]);

  return null;
}

function RootLayout() {
  return (
    <>
      <ProgressProvider color="blue" height="4px">
        <NavigationProgress />
        <Outlet />
      </ProgressProvider>
    </>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
