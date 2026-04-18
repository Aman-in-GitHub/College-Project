import type { QueryClient } from "@tanstack/react-query";

import { ProgressProvider, useProgress } from "@bprogress/react";
import {
  HeadContent,
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { Toaster } from "@/components/ui/sonner";

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
      <HeadContent />
      <ProgressProvider color="#432dd7" height="4px">
        <NavigationProgress />
        <Link to="/" className="flex w-full items-center justify-center">
          <img src="/favicon.svg" alt="College Project Logo" className="size-32" />
        </Link>
        <Outlet />
        <Toaster position="top-center" duration={5000} visibleToasts={3} richColors={true} />
      </ProgressProvider>
    </>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  head: () => ({
    meta: [
      {
        title: "College Project",
      },
    ],
  }),
});
